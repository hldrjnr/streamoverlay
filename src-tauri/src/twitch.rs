use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use tauri::{AppHandle, Emitter};
use tokio_tungstenite::{connect_async, tungstenite::Message};

use crate::types::ChatMessage;

fn extract_channel(url: &str) -> Result<String, String> {
    // https://twitch.tv/username or https://www.twitch.tv/username
    let re = regex::Regex::new(r"twitch\.tv/([a-zA-Z0-9_]{3,25})").unwrap();
    if let Some(caps) = re.captures(url) {
        return Ok(caps[1].to_lowercase());
    }
    // allow bare username
    let trimmed = url.trim().trim_matches('/');
    if regex::Regex::new(r"^[a-zA-Z0-9_]{3,25}$").unwrap().is_match(trimmed) {
        return Ok(trimmed.to_lowercase());
    }
    Err(format!("URL Twitch inválida: {}", url))
}

fn parse_tags(line: &str) -> (String, String, String) {
    // line starts with @tags
    // tags example: badge-info=;badges=moderator/1;color=#FF0000;display-name=User;emotes=;id=abc123;mod=1;subscriber=0;user-id=123
    let mut display_name = String::new();
    let mut user_id = String::new();
    let mut msg_id = String::new();
    if let Some(space) = line.find(' ') {
        let tags_part = &line[1..space];
        for kv in tags_part.split(';') {
            if let Some((k, v)) = kv.split_once('=') {
                match k {
                    "display-name" => display_name = v.to_string(),
                    "user-id" => user_id = v.to_string(),
                    "id" => msg_id = v.to_string(),
                    _ => {}
                }
            }
        }
    }
    (display_name, user_id, msg_id)
}

fn parse_privmsg(line: &str) -> Option<ChatMessage> {
    // With tags: @tags :user!user@user.tmi.twitch.tv PRIVMSG #channel :message
    // Without tags: :user!user@user.tmi.twitch.tv PRIVMSG #channel :message
    let (tags, rest) = if line.starts_with('@') {
        if let Some(idx) = line.find(" :") {
            (&line[..idx], &line[idx + 1..])
        } else {
            ("", line)
        }
    } else {
        ("", line)
    };

    // rest = :nick!user@host PRIVMSG #channel :message
    let privmsg_idx = rest.find(" PRIVMSG ")?;
    let prefix = &rest[..privmsg_idx];
    let after = &rest[privmsg_idx + " PRIVMSG ".len()..];
    // after = #channel :message
    let msg_start = after.find(" :")?;
    let message = after[msg_start + 2..].to_string();

    let nick = prefix
        .trim_start_matches(':')
        .split('!')
        .next()
        .unwrap_or("twitch_user")
        .to_string();

    let (display_name, user_id, msg_id) = if tags.is_empty() {
        (String::new(), String::new(), String::new())
    } else {
        parse_tags(&format!("{} {}", tags, rest))
    };

    let author_name = if !display_name.is_empty() { display_name } else { nick.clone() };
    let id = if !msg_id.is_empty() { msg_id } else { format!("twitch-{}-{}", nick, chrono::Utc::now().timestamp_millis()) };

    Some(ChatMessage {
        id,
        author: user_id.clone(),
        author_channel_id: user_id,
        author_name,
        author_handle: nick,
        author_photo: String::new(),
        message,
        timestamp: String::new(),
        timestamp_ms: chrono::Utc::now().timestamp_millis() as u64,
        is_super_chat: false,
        super_chat_amount: None,
        is_membership: false,
        is_moderator: tags.contains("moderator/1") || tags.contains("mod=1"),
        is_owner: tags.contains("broadcaster/1"),
        badge_url: None,
        provider: "twitch".to_string(),
    })
}

pub async fn run_twitch(url: &str, app: AppHandle) -> Result<(), String> {
    let channel = extract_channel(url)?;
    let ws_url = "wss://irc-ws.chat.twitch.tv:443";

    let _ = app.emit("connection-progress", json!({ "message": format!("Conectando Twitch #{}...", channel) }));

    let (ws_stream, _) = connect_async(ws_url)
        .await
        .map_err(|e| format!("Falha ao conectar Twitch IRC: {}", e))?;

    let (mut write, mut read) = ws_stream.split();

    // Anonymous login — justinfan
    let nick = format!("justinfan{}", rand_id());
    write.send(Message::Text("CAP REQ :twitch.tv/tags twitch.tv/commands".into()))
        .await.map_err(|e| e.to_string())?;
    write.send(Message::Text(format!("PASS SCHMOOPIIE"))).await.map_err(|e| e.to_string())?;
    write.send(Message::Text(format!("NICK {}", nick))).await.map_err(|e| e.to_string())?;
    write.send(Message::Text(format!("JOIN #{}", channel))).await.map_err(|e| e.to_string())?;

    let _ = app.emit("connection-progress", json!({ "message": format!("Conectado Twitch #{}!", channel) }));

    // Spawn ping loop
    let app_clone = app.clone();
    // read loop
    while let Some(msg) = read.next().await {
        match msg {
            Ok(Message::Text(text)) => {
                for line in text.lines() {
                    let line = line.trim();
                    if line.is_empty() { continue; }
                    if line.starts_with("PING") {
                        let pong = line.replacen("PING", "PONG", 1);
                        let _ = write.send(Message::Text(pong)).await;
                        continue;
                    }
                    if line.contains(" PRIVMSG ") {
                        if let Some(chat_msg) = parse_privmsg(line) {
                            let _ = app_clone.emit("chat-message", chat_msg);
                        }
                    }
                    // ignore other
                }
            }
            Ok(Message::Ping(data)) => {
                let _ = write.send(Message::Pong(data)).await;
            }
            Ok(_) => {}
            Err(e) => {
                let _ = app_clone.emit("chat-error", json!({ "message": format!("Twitch desconectado: {}", e) }));
                return Err(format!("Twitch erro: {}", e));
            }
        }
    }

    Err("Conexão Twitch encerrada".to_string())
}

fn rand_id() -> u32 {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    use std::time::SystemTime;
    let mut hasher = DefaultHasher::new();
    SystemTime::now().hash(&mut hasher);
    (hasher.finish() % 80000 + 10000) as u32
}
