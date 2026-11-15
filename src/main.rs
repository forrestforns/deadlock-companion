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

use std::os::windows::process::CommandExt;
const CREATE_NO_WINDOW: u32 = 0x0800_0000; // no console flash from a GUI app

fn read_config(app: &AppHandle) -> Value {
    serde_json::from_str(&load_config(app.clone())).unwrap_or_default()
}

/// Closing the window keeps the app running in the tray, unless turned off in Réglages.
fn keeps_in_tray(app: &AppHandle) -> bool {
    read_config(app)["tray"] != json!(false)
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Tray menu entries, renamed from the page in the app's language.
struct TrayItems(tauri::menu::MenuItem<tauri::Wry>, tauri::menu::MenuItem<tauri::Wry>);

#[tauri::command]
fn set_tray_labels(items: tauri::State<TrayItems>, open: String, quit: String) {
    let _ = items.0.set_text(open);
    let _ = items.1.set_text(quit);
}

const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";

/// Windows' reg.exe by full path: a bare "reg" is first looked up next to the app's own exe.
fn reg_exe() -> PathBuf {
    let windir = std::env::var_os("SystemRoot").unwrap_or_else(|| r"C:\Windows".into());
    PathBuf::from(windir).join("System32").join("reg.exe")
}

fn reg(args: &[&str]) -> bool {
    std::process::Command::new(reg_exe())
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Launch at Windows logon: the user's own Run key, nothing system-wide.
#[tauri::command(async)]
fn get_autostart() -> bool {
    reg(&["query", RUN_KEY, "/v", "DeadlockCompanion"])
}

#[tauri::command(async)]
fn set_autostart(enabled: bool) -> Result<(), String> {
    let ok = if enabled {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        // starts hidden in the tray
        let value = format!("\"{}\" --minimized", exe.display());
        reg(&["add", RUN_KEY, "/v", "DeadlockCompanion", "/t", "REG_SZ", "/d", &value, "/f"])
    } else {
        reg(&["delete", RUN_KEY, "/v", "DeadlockCompanion", "/f"])
    };
    if ok { Ok(()) } else { Err("registre Windows inaccessible".into()) }
}

// Single instance: the running app owns a named Windows event. A second launch signals it (the running
// app then shows its own window, through Tauri) and quits. Matching a window title instead would also
// match e.g. an Explorer window on a folder named "Deadlock Companion".
#[link(name = "kernel32")]
extern "system" {
    fn CreateEventW(attributes: *const std::ffi::c_void, manual_reset: i32, initial: i32, name: *const u16) -> isize;
    fn OpenEventW(access: u32, inherit: i32, name: *const u16) -> isize;
    fn SetEvent(event: isize) -> i32;
    fn WaitForSingleObject(handle: isize, ms: u32) -> u32;
    fn CloseHandle(handle: isize) -> i32;
}
#[link(name = "user32")]
extern "system" {
    fn AllowSetForegroundWindow(process_id: u32) -> i32;
}

fn show_event_name() -> Vec<u16> {
    "Local\\DeadlockCompanion.Show\0".encode_utf16().collect()
}

/// Already running (maybe hidden in the tray)? Ask it to show its window: this process then quits.
/// A restarting instance (watchdog, update) is gone within a moment, so wait for that first.
fn signal_running_instance() -> bool {
    const EVENT_MODIFY_STATE: u32 = 0x0002;
    let name = show_event_name();
    for attempt in 0..20 {
        let h = unsafe { OpenEventW(EVENT_MODIFY_STATE, 0, name.as_ptr()) };
        if h == 0 {
            return false;
        }
        if attempt == 19 {
            unsafe {
                AllowSetForegroundWindow(u32::MAX); // let the running app come to the front
                SetEvent(h);
                CloseHandle(h);
            }
            return true;
        }
        unsafe { CloseHandle(h) }; // don't keep it alive while waiting for it to disappear
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    false
}

/// Creates the event and shows the window each time a second launch signals it.
fn listen_for_second_launch(app: AppHandle) {
    let name = show_event_name();
    let h = unsafe { CreateEventW(std::ptr::null(), 0, 0, name.as_ptr()) };
    if h == 0 {
        return;
    }
    std::thread::spawn(move || {
        while unsafe { WaitForSingleObject(h, u32::MAX) } == 0 {
            show_main(&app);
        }
    });
}

/// The app's own pages (http://tauri.localhost on Windows, tauri:// elsewhere).
fn is_app_url(url: &tauri::Url) -> bool {
    url.scheme() == "tauri" || url.host_str() == Some("tauri.localhost")
}

/// Steam install dir from the registry, else the default location.
fn steam_dir() -> PathBuf {
    std::process::Command::new(reg_exe())
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

/// Deadlock's official Steam announcements (patch notes included), from Steam's public news API.
/// Fetched here rather than in the page: no CORS or CSP exception needed for api.steampowered.com.
#[tauri::command]
async fn patch_notes() -> Result<Value, String> {
    let url = "https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=1422450&count=60&maxlength=0&feeds=steam_community_announcements";
    // full error chain: reqwest's own message ("error sending request") hides the cause
    let chain = |e: reqwest::Error| {
        let mut s = e.to_string();
        let mut src = std::error::Error::source(&e);
        while let Some(c) = src {
            s += &format!(" : {c}");
            src = c.source();
        }
        s
    };
    let http = reqwest::Client::builder().timeout(std::time::Duration::from_secs(15)).build().map_err(chain)?;
    let body = http.get(url).send().await.and_then(|r| r.error_for_status()).map_err(chain)?;
    serde_json::from_str(&body.text().await.map_err(chain)?).map_err(|e| e.to_string())
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
            // minimized or hidden in the tray: come back the same way
            let minimized = win.is_minimized().unwrap_or(false) || !win.is_visible().unwrap_or(true);
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
    if signal_running_instance() {
        return;
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        // the window only ever shows the app itself: no navigation to another site, even from
        // a malicious value slipped into API data (fake login page inside the app...)
        .plugin(
            tauri::plugin::Builder::<tauri::Wry>::new("nav-lock")
                .on_navigation(|_, url| is_app_url(url))
                .build(),
        )
        .setup(|app| {
            use tauri::menu::{Menu, MenuItem};
            use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
            let open = MenuItem::with_id(app, "open", "Ouvrir", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quitter", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().ok_or("icône de l'app manquante")?)
                .tooltip("Deadlock Companion")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, e| match e.id.as_ref() {
                    "open" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, e| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;
            app.manage(TrayItems(open, quit));
            listen_for_second_launch(app.handle().clone());

            if std::env::args().any(|a| a == "--minimized") {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = if keeps_in_tray(app.handle()) { win.hide() } else { win.minimize() };
                }
            }
            watchdog(app.handle().clone());
            Ok(())
        })
        .on_window_event(|win, ev| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = ev {
                if keeps_in_tray(win.app_handle()) {
                    api.prevent_close();
                    let _ = win.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_config,
            heartbeat,
            scan_steam_cache,
            patch_notes,
            set_tray_labels,
            get_autostart,
            set_autostart,
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

    /// network check of the patch notes source: `cargo test patch_notes_now -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn patch_notes_now() {
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let v = rt.block_on(patch_notes()).expect("patch notes");
        let items = v["appnews"]["newsitems"].as_array().expect("newsitems");
        println!("{} annonces, la plus récente : {}", items.len(), items[0]["title"]);
    }

    #[test]
    fn second_launch_signals_the_running_one() {
        let name: Vec<u16> = "Local\\DeadlockCompanion.Test\0".encode_utf16().collect();
        const EVENT_MODIFY_STATE: u32 = 0x0002;
        assert_eq!(unsafe { OpenEventW(EVENT_MODIFY_STATE, 0, name.as_ptr()) }, 0, "no instance yet");
        let h = unsafe { CreateEventW(std::ptr::null(), 0, 0, name.as_ptr()) };
        let o = unsafe { OpenEventW(EVENT_MODIFY_STATE, 0, name.as_ptr()) };
        assert_ne!(o, 0, "running instance found");
        unsafe { SetEvent(o) };
        assert_eq!(unsafe { WaitForSingleObject(h, 1000) }, 0, "running instance woken up");
        unsafe {
            CloseHandle(o);
            CloseHandle(h);
        }
        assert_eq!(unsafe { OpenEventW(EVENT_MODIFY_STATE, 0, name.as_ptr()) }, 0, "gone with its last handle");
    }

    #[test]
    fn window_stays_on_the_app() {
        let ok = |u: &str| is_app_url(&tauri::Url::parse(u).unwrap());
        assert!(ok("http://tauri.localhost/index.html"));
        assert!(ok("tauri://localhost/index.html"));
        assert!(!ok("https://evil.com/login"));
        assert!(!ok("http://tauri.localhost.evil.com/"));
        assert!(!ok("https://api.deadlock-api.com/"));
    }

    /// writes then removes the user's Run key entry: `cargo test autostart_roundtrip -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn autostart_roundtrip() {
        set_autostart(true).unwrap();
        let out = std::process::Command::new(reg_exe()).args(["query", RUN_KEY, "/v", "DeadlockCompanion"]).output().unwrap();
        let text = String::from_utf8_lossy(&out.stdout).into_owned();
        println!("{text}");
        assert!(text.contains("\" --minimized"), "exe path must be quoted");
        set_autostart(false).unwrap();
        assert!(!get_autostart());
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
