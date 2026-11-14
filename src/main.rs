// Deadlock companion: public API data only.
// Never touches the game process (no memory reads, no injection, no input automation).
// The only local data read besides our config is Steam's HTTP cache, for match file URLs.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod live;

use serde_json::{json, Value};
use std::io::Read;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_config_dir().map_err(|e| e.to_string())?.join("config.json"))
}

#[tauri::command]
fn load_config(app: AppHandle) -> String {
    config_path(&app)
        .and_then(|p| std::fs::read_to_string(p).map_err(|e| e.to_string()))
        .unwrap_or_else(|_| "{}".into())
}

#[tauri::command]
fn save_config(app: AppHandle, data: String) -> Result<(), String> {
    serde_json::from_str::<Value>(&data).map_err(|e| e.to_string())?;
    let p = config_path(&app)?;
    std::fs::create_dir_all(p.parent().unwrap()).map_err(|e| e.to_string())?;
    // temp file + rename so a crash mid-write can't wipe the config
    let tmp = p.with_extension("tmp");
    std::fs::write(&tmp, data).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &p).map_err(|e| e.to_string())
}

/// Steam install dir from the registry, else the default location.
fn steam_dir() -> PathBuf {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000; // no console flash from a GUI app
    std::process::Command::new("reg")
        .args(["query", r"HKCU\Software\Valve\Steam", "/v", "SteamPath"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()
        .and_then(|o| {
            let out = String::from_utf8_lossy(&o.stdout).into_owned();
            out.split("REG_SZ").nth(1).map(|p| PathBuf::from(p.trim()))
        })
        .unwrap_or_else(|| PathBuf::from(r"C:\Program Files (x86)\Steam"))
}

fn split_num(s: &str) -> Option<(u64, &str)> {
    let n = s.find(|c: char| !c.is_ascii_digit()).unwrap_or(s.len());
    if n == 0 {
        return None;
    }
    Some((s[..n].parse().ok()?, &s[n..]))
}

/// Parses a cache entry holding a Deadlock match file URL:
/// replay<cluster>.valve.net<sep>/1422450/<match_id>_<salt>.(meta|dem).bz2
fn parse_salt(buf: &[u8]) -> Option<Value> {
    let s = String::from_utf8_lossy(buf);
    let rest = &s[s.find("replay")? + 6..];
    let (cluster, rest) = split_num(rest)?;
    let rest = rest.strip_prefix(".valve.net")?;
    let slash = rest.find('/')?;
    if slash > 8 {
        return None;
    }
    let rest = rest[slash..].strip_prefix("/1422450/")?; // Deadlock's app id
    let (match_id, rest) = split_num(rest)?;
    let (salt, rest) = split_num(rest.strip_prefix('_')?)?;
    if match_id > 10_000_000_000 || salt > u32::MAX as u64 {
        return None;
    }
    let (meta, replay) = if rest.starts_with(".meta.bz2") {
        (Some(salt), None)
    } else if rest.starts_with(".dem.bz2") {
        (None, Some(salt))
    } else {
        return None;
    };
    Some(json!({ "match_id": match_id, "cluster_id": cluster, "metadata_salt": meta, "replay_salt": replay }))
}

/// Match salts found in Steam's HTTP cache (appcache/httpcache/<xx>/<file>).
/// async: thousands of files, kept off the window's thread so the UI never freezes
#[tauri::command(async)]
fn scan_steam_cache() -> Vec<Value> {
    let root = steam_dir().join("appcache").join("httpcache");
    let mut found = vec![];
    let Ok(dirs) = std::fs::read_dir(root) else { return found };
    for dir in dirs.flatten() {
        let Ok(files) = std::fs::read_dir(dir.path()) else { continue };
        for f in files.flatten() {
            let mut buf = [0u8; 512];
            let n = std::fs::File::open(f.path()).and_then(|mut h| h.read(&mut buf)).unwrap_or(0);
            if let Some(v) = parse_salt(&buf[..n]) {
                found.push(v);
            }
        }
    }
    found
}

/// Last heartbeat from the page (unix seconds). WebView2 can die while the window stays open,
/// leaving a black window; if the page has gone quiet when the user comes back, restart the app.
static LAST_BEAT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn now_secs() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

#[tauri::command]
fn heartbeat() {
    LAST_BEAT.store(now_secs(), std::sync::atomic::Ordering::Relaxed);
}

/// The page beats every 5 s; 20 s of silence means its engine is gone.
fn page_is_dead(last: u64, now: u64) -> bool {
    last != 0 && now.saturating_sub(last) > 20
}

/// Restarts the app when the page stops beating, keeping it minimized if it was,
/// so a recovery never pops up over the game.
fn watchdog(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last_loop = now_secs();
        loop {
            std::thread::sleep(std::time::Duration::from_secs(5));
            let now = now_secs();
            // a long gap means the PC was asleep: give the page time to beat again
            let woke_up = now.saturating_sub(last_loop) > 15;
            last_loop = now;
            if woke_up || !page_is_dead(LAST_BEAT.load(std::sync::atomic::Ordering::Relaxed), now) {
                continue;
            }
            let Some(win) = app.get_webview_window("main") else { continue };
            let minimized = win.is_minimized().unwrap_or(false);
            if let Ok(exe) = std::env::current_exe() {
                let mut cmd = std::process::Command::new(exe);
                if minimized {
                    cmd.arg("--minimized");
                }
                if cmd.spawn().is_ok() {
                    app.exit(0);
                }
            }
            return;
        }
    });
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            if std::env::args().any(|a| a == "--minimized") {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.minimize();
                }
            }
            watchdog(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_config,
            heartbeat,
            scan_steam_cache,
            live::current_match,
            live::live_players
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de Deadlock Companion");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn watchdog() {
        assert!(!page_is_dead(0, 1_000)); // no beat yet: page still loading
        assert!(!page_is_dead(990, 1_000));
        assert!(page_is_dead(970, 1_000));
    }

    #[test]
    fn parses_deadlock_entries_only() {
        let meta = b"\x01\x02 X+\x00replay404.valve.net\x00/1422450/37959196_937530290.meta.bz2\x00\x00user-agent";
        let v = parse_salt(meta).unwrap();
        assert_eq!(v["match_id"], 37959196);
        assert_eq!(v["cluster_id"], 404);
        assert_eq!(v["metadata_salt"], 937530290);
        assert!(v["replay_salt"].is_null());

        let dem = b"replay183.valve.net/1422450/42476710_428480166.dem.bz2";
        assert_eq!(parse_salt(dem).unwrap()["replay_salt"], 428480166);

        // CS2 replays (app 730) live in the same cache and must be ignored
        let cs2 = b"replay274.valve.net\x00/730/003813990392605442193_0680812100.dem.bz2";
        assert!(parse_salt(cs2).is_none());
        assert!(parse_salt(b"no url here").is_none());
    }
}
