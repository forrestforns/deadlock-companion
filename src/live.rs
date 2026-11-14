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

/// Id of the online match in the log: the last "Lobby X for Match Y created" followed by a
/// connection to a remote server (the hideout also creates a local match, on loopback).
pub fn match_id_from_log(log: &str) -> Option<u64> {
    let mut current: Option<u64> = None;
    let mut online: Option<u64> = None;
    for line in log.lines() {
        if let Some(rest) = line.split("for Match ").nth(1) {
            if line.contains("Lobby ") && rest.trim_end().ends_with("created") {
                current = rest.split_whitespace().next().and_then(|n| n.parse().ok());
                online = None;
            }
        } else if line.contains("Connected to '=[A:") {
            online = current;
        }
    }
    online
}

#[tauri::command]
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

    #[test]
    fn finds_online_match_not_hideout() {
        let log = "\
11/14 15:52:38 Lobby 102166054893422416 for Match 137285346 created
11/14 15:52:39 [Client] CL:  Connected to 'loopback:1'
11/14 16:00:17 Lobby 174223648931389985 for Match 137307683 created
11/14 16:00:18 [Client] CL:  Connected to '=[A:1:185569309:52492]'
11/14 16:30:00 Lobby 1 for Match 999 created
";
        // the last lobby (hideout, no remote connection yet) is not an online match
        assert_eq!(match_id_from_log(log), None);
        let log2 = &log[..log.find("11/14 16:30").unwrap()];
        assert_eq!(match_id_from_log(log2), Some(137307683));
        assert_eq!(match_id_from_log("nothing"), None);
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
