//! Live match: the match id comes from the game's own console log (written with the `-condebug`
//! launch option), the players from Valve's public spectator broadcast of that match.
//! Only scoreboard data is read (team, hero, K/D/A, souls, level) — never positions or cooldowns.

use std::cell::RefCell;
use std::path::PathBuf;
use std::rc::Rc;
use std::time::Duration;

use haste::broadcast::BroadcastHttp;
use haste::entities::fkey_from_path;
use haste::fxhash;
use haste::parser::{Context, Parser, Visitor};
use serde_json::{json, Value};

/// Deadlock install dirs, from Steam's library list.
fn game_dirs(steam: &PathBuf) -> Vec<PathBuf> {
    let vdf = std::fs::read_to_string(steam.join("steamapps").join("libraryfolders.vdf")).unwrap_or_default();
    let mut libs: Vec<PathBuf> = vdf
        .lines()
        .filter_map(|l| {
            let l = l.trim();
            let rest = l.strip_prefix("\"path\"")?.trim();
            Some(PathBuf::from(rest.trim_matches('"').replace("\\\\", "\\")))
        })
        .collect();
    libs.push(steam.clone());
    libs.into_iter().map(|l| l.join("steamapps").join("common").join("Deadlock")).filter(|d| d.is_dir()).collect()
}

/// Id of the match being played, from the game log. A "Lobby X for Match Y created" line is
/// followed by "Persisting reconnect info: server_steam_id: S"; the match is live only while
/// connected to that server ("Connected to '=[A:1:<S % 2^32>:…'"). Other remote servers (the
/// hideout), a disconnect or the PostGame state mean we're no longer in it.
pub fn match_id_from_log(log: &str) -> Option<u64> {
    let num_after = |line: &str, key: &str| -> Option<u64> {
        let rest = &line[line.find(key)? + key.len()..];
        rest.trim_start().split(|c: char| !c.is_ascii_digit()).next()?.parse().ok()
    };
    let mut current: Option<u64> = None;
    let mut server: Option<u64> = None; // account part of the match server's steam id
    let mut online: Option<u64> = None;
    for line in log.lines() {
        if line.contains("Lobby ") && line.contains("for Match ") && line.trim_end().ends_with("created") {
            current = num_after(line, "for Match ");
            server = None;
            online = None;
        } else if line.contains("Persisting reconnect info") {
            server = num_after(line, "server_steam_id:").map(|s| s % (1u64 << 32));
        } else if line.contains("Connected to '=[A:1:") {
            let connected = num_after(line, "=[A:1:");
            online = if connected.is_some() && connected == server { current } else { None };
        } else if line.contains("Disconnecting from server") || line.contains("OnGameStateChanged: PostGame") {
            online = None;
        }
    }
    online
}

#[tauri::command(async)] // file read off the window's thread
pub fn current_match() -> Option<u64> {
    for dir in game_dirs(&crate::steam_dir()) {
        let path = dir.join("game").join("citadel").join("console.log");
        let Ok(bytes) = std::fs::read(&path) else { continue };
        // the log only grows during a session; the tail is enough
        let tail = &bytes[bytes.len().saturating_sub(4 << 20)..];
        if let Some(id) = match_id_from_log(&String::from_utf8_lossy(tail)) {
            return Some(id);
        }
    }
    None
}

const ACCOUNT: u64 = fkey_from_path(&["m_unEconAccountID"]);
const TEAM: u64 = fkey_from_path(&["m_iTeamNum"]);
const NAME: u64 = fkey_from_path(&["m_iszPlayerName"]);
// scoreboard values live in the embedded m_PlayerDataGlobal struct (a send node)
const HERO: u64 = fkey_from_path(&["m_PlayerDataGlobal", "m_nHeroID"]);
const KILLS: u64 = fkey_from_path(&["m_PlayerDataGlobal", "m_iPlayerKills"]);
const DEATHS: u64 = fkey_from_path(&["m_PlayerDataGlobal", "m_iDeaths"]);
const ASSISTS: u64 = fkey_from_path(&["m_PlayerDataGlobal", "m_iPlayerAssists"]);
const SOULS: u64 = fkey_from_path(&["m_PlayerDataGlobal", "m_iGoldNetWorth"]);
const LEVEL: u64 = fkey_from_path(&["m_PlayerDataGlobal", "m_iLevel"]);

#[derive(Default)]
struct Scoreboard {
    // shared with the caller: haste's Parser has no accessor for its visitor
    result: Rc<RefCell<Option<Value>>>,
}

impl Visitor for Scoreboard {
    fn on_tick_end(&mut self, ctx: &Context) -> anyhow::Result<()> {
        if self.result.borrow().is_some() {
            return Ok(());
        }
        let Some(entities) = ctx.entities() else { return Ok(()) };
        let controller = fxhash::hash_bytes(b"CCitadelPlayerController");
        let players: Vec<Value> = entities
            .iter()
            .map(|(_, e)| e)
            .filter(|e| e.serializer_name_heq(controller))
            .filter_map(|e| {
                let team: u64 = e.get_value(&TEAM)?;
                let hero: u64 = e.get_value(&HERO).unwrap_or(0);
                // spectators / unassigned slots have no playable team
                if team != 2 && team != 3 {
                    return None;
                }
                let name: Box<[u8]> = e.get_value(&NAME).unwrap_or_default();
                Some(json!({
                    "account_id": e.get_value::<u64>(&ACCOUNT).unwrap_or(0),
                    "team": team - 2, // 2/3 in game -> 0/1 like the API
                    "hero_id": hero,
                    "name": String::from_utf8_lossy(&name),
                    "kills": e.get_value::<i64>(&KILLS).unwrap_or(0),
                    "deaths": e.get_value::<i64>(&DEATHS).unwrap_or(0),
                    "assists": e.get_value::<i64>(&ASSISTS).unwrap_or(0),
                    "net_worth": e.get_value::<i64>(&SOULS).unwrap_or(0),
                    "level": e.get_value::<i64>(&LEVEL).unwrap_or(0),
                }))
            })
            .collect();
        if players.len() >= 12 {
            *self.result.borrow_mut() = Some(json!({
                "game_time": (ctx.tick() as f32 * ctx.tick_interval()) as u64,
                "players": players,
            }));
        }
        Ok(())
    }
}

async fn read_scoreboard(url: String) -> anyhow::Result<Value> {
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert("user-agent", "Valve/Steam HTTP Client 1.0 (1422450)".parse()?);
    let http = reqwest::Client::builder().timeout(Duration::from_secs(10)).default_headers(headers).build()?;
    let stream = BroadcastHttp::start_streaming(http, &url).await?;
    let result = Rc::new(RefCell::new(None));
    let mut parser = Parser::from_stream_with_visitor(stream, Scoreboard { result: result.clone() })?;
    loop {
        match parser.demo_stream_mut().next_packet().await {
            Some(Ok(_)) => {
                parser.run_to_end()?;
                if let Some(v) = result.borrow_mut().take() {
                    return Ok(v);
                }
            }
            Some(Err(e)) => return Err(e.into()),
            None => anyhow::bail!("diffusion terminée"),
        }
    }
}

#[tauri::command]
pub async fn live_players(url: String) -> Result<Value, String> {
    // haste's parser is not Send: run it on its own single-threaded runtime
    tauri::async_runtime::spawn_blocking(move || {
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().map_err(|e| e.to_string())?;
        rt.block_on(async {
            tokio::time::timeout(Duration::from_secs(30), read_scoreboard(url))
                .await
                .map_err(|_| "délai dépassé en lisant la diffusion".to_string())?
                .map_err(|e| e.to_string())
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    // real lines from a game log (match 137487528, server account 1640640517)
    const LOG: &str = "\
11/14 21:25:30 OnGameStateChanged: PostGame (8)
11/14 21:25:40 [Client] Disconnecting from server: NETWORK_DISCONNECT_DISCONNECT_BY_USER
11/14 21:25:41 [Client] CL:  Connected to 'loopback:1'
11/14 21:25:41 [Client] CL:  Connected to '=[A:1:1703283742:52499]'
11/14 21:38:12 Lobby 174223648931579271 for Match 137487528 created
11/14 21:38:12 Persisting reconnect info to disk: server_steam_id: 90297475676123141 lobby_id: 174223648931579271 time_updated: 1794688692
11/14 21:38:12 [Client] Disconnecting from server: NETWORK_DISCONNECT_SHUTDOWN
11/14 21:38:13 [Client] CL:  Connected to 'loopback:1'
11/14 21:38:18 [Client] CL:  Connected to '127.0.0.1:27015'
11/14 21:39:26 [Client] Disconnecting from server: NETWORK_DISCONNECT_LOOPDEACTIVATE
11/14 21:39:27 [Client] CL:  Connected to '=[A:1:1640640517:52499]'
11/14 21:40:05 OnGameStateChanged: GameInProgress (7)
";

    #[test]
    fn finds_match_only_on_its_own_server() {
        assert_eq!(match_id_from_log(LOG), Some(137487528));
        // before joining the match server: not live yet
        let joining = &LOG[..LOG.find("11/14 21:39:27").unwrap()];
        assert_eq!(match_id_from_log(joining), None);
        // after the match: post-game, then back to the hideout (another remote server)
        let after = format!("{LOG}11/14 22:30:00 OnGameStateChanged: PostGame (8)\n11/14 22:30:10 [Client] CL:  Connected to '=[A:1:1703283742:52499]'\n");
        assert_eq!(match_id_from_log(&after), None);
        // the hideout's remote server alone is never a match
        assert_eq!(match_id_from_log(&LOG[..LOG.find("11/14 21:38:12").unwrap()]), None);
        assert_eq!(match_id_from_log("nothing"), None);
    }

    /// manual check of the detection on the real game log (no network): `cargo test log_now -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn log_now() {
        println!("partie détectée : {:?}", current_match());
    }

    /// manual end-to-end check during a real match: `cargo test -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn live_now() {
        let id = current_match().expect("no online match in console.log");
        println!("match {id}");
        let api: Value = reqwest::blocking::get(format!("https://api.deadlock-api.com/v1/matches/{id}/live/url"))
            .and_then(|r| r.json())
            .expect("live url");
        let url = api["broadcast_url"].as_str().unwrap().to_string();
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let v = rt.block_on(read_scoreboard(url)).expect("scoreboard");
        println!("{v:#}");
        assert_eq!(v["players"].as_array().unwrap().len(), 12);
    }
}
