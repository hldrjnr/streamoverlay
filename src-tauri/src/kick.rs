use reqwest::Client;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::{connect_async, tungstenite::Message};

use crate::types::ChatMessage;

fn extract_slug(url: &str) -> Result<String, String> {
    // https://kick.com/username or kick.com/username
    let re = regex::Regex::new(r"kick\.com/([a-zA-Z0-9_]{3,30})").unwrap();
    if let Some(caps) = re.captures(url) {
        return Ok(caps[1].to_string());
    }
    let trimmed = url.trim().trim_matches('/').to_string();
    if regex::Regex::new(r"^[a-zA-Z0-9_]{3,30}$").unwrap().is_match(&trimmed) {
        return Ok(trimmed);
    }
    Err(format!("URL Kick inválida: {}", url))
}

async fn fetch_chatroom_id(slug: &str, client: &Client) -> Result<u64, String> {
    // Kick API v2: https://kick.com/api/v2/channels/{slug}
    let url = format!("https://kick.com/api/v2/channels/{}", slug);
    let resp = client
        .get(&url)
        .header("User-Agent", "Mozilla/5.0")
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Falha ao buscar canal Kick: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Kick HTTP {} para canal {}", resp.status(), slug));
    }
    let v: Value = resp.json().await.map_err(|e| format!("Kick JSON inválido: {}", e))?;
    // path: chatroom.id
    if let Some(id) = v.pointer("/chatroom/id").and_then(|x| x.as_u64()) {
        return Ok(id);
    }
    if let Some(id) = v.pointer("/chatroom/id").and_then(|x| x.as_i64()) {
        return Ok(id as u64);
    }
    Err(format!("Chatroom não encontrado para {}", slug))
}

pub async fn run_kick(url: &str, app: AppHandle) -> Result<(), String> {
    let slug = extract_slug(url)?;
    let client = Client::builder().timeout(std::time::Duration::from_secs(15)).build().unwrap();

    let _ = app.emit("connection-progress", json!({ "message": format!("Buscando canal Kick {}...", slug) }));
    let chatroom_id = fetch_chatroom_id(&slug, &client).await?;

    let _ = app.emit("connection-progress", json!({ "message": format!("Conectando Kick {} (chatroom {})...", slug, chatroom_id) }));

    // Pusher WS
    let pusher_url = "wss://ws-us2.pusher.com/app/eb1d5f4ae76d386d3b289973963e7c44?protocol=7&client=js&version=8.4.0-rc2&flash=false";
    let (ws_stream, _) = connect_async(pusher_url)
        .await
        .map_err(|e| format!("Falha ao conectar Kick Pusher: {}", e))?;

    let (mut write, mut read) = ws_stream.split();

    // Subscribe to chatrooms.{id}.v2
    let channel = format!("chatrooms.{}.v2", chatroom_id);
    let sub_msg = json!({
        "event": "pusher:subscribe",
        "data": { "auth": "", "channel": channel }
    });
    write.send(Message::Text(sub_msg.to_string())).await.map_err(|e| e.to_string())?;

    let _ = app.emit("connection-progress", json!({ "message": format!("Conectado Kick {}!", slug) }));

    while let Some(msg) = read.next().await {
        match msg {
            Ok(Message::Text(text)) => {
                // Pusher envelope: {"event":"App\\Events\\ChatMessageEvent","data":"{...}","channel":"..."}
                if let Ok(v) = serde_json::from_str::<Value>(&text) {
                    if let Some(event) = v.get("event").and_then(|e| e.as_str()) {
                        if event == "pusher:connection_established" {
                            continue;
                        }
                        if event == "App\\Events\\ChatMessageEvent" || event.contains("ChatMessageEvent") {
                            if let Some(data_str) = v.get("data").and_then(|d| d.as_str()) {
                                if let Ok(data) = serde_json::from_str::<Value>(data_str) {
                                    if let Some(chat_msg) = parse_kick_message(&data) {
                                        let _ = app.emit("chat-message", chat_msg);
                                    }
                                }
                            } else if let Some(data) = v.get("data") {
                                if let Some(chat_msg) = parse_kick_message(data) {
                                    let _ = app.emit("chat-message", chat_msg);
                                }
                            }
                        }
                    }
                }
            }
            Ok(Message::Ping(d)) => { let _ = write.send(Message::Pong(d)).await; }
            Ok(_) => {}
            Err(e) => {
                let _ = app.emit("chat-error", json!({ "message": format!("Kick desconectado: {}", e) }));
                return Err(format!("Kick erro: {}", e));
            }
        }
    }
    Err("Conexão Kick encerrada".to_string())
}

fn parse_kick_message(data: &Value) -> Option<ChatMessage> {
    // Kick data structure: { "sender": { "username","id","profile_picture" }, "content": "hello", "id": "...", "created_at": "...", ... }
    // Some variants wrap in data.data
    let sender = data.get("sender").or_else(|| data.pointer("/data/sender"))?;
    let content = data.get("content").or_else(|| data.pointer("/data/content"))
        .and_then(|v| v.as_str())
        .or_else(|| data.get("message").and_then(|v| v.as_str()))?;
    let username = sender.get("username").and_then(|v| v.as_str())
        .or_else(|| sender.get("slug").and_then(|v| v.as_str()))
        .unwrap_or("kick_user");
    let user_id = sender.get("id").and_then(|v| v.as_u64()).map(|n| n.to_string()).unwrap_or_default();
    let pfp = sender.get("profile_picture").or_else(|| sender.get("profile_pic")).and_then(|v| v.as_str()).unwrap_or("").to_string();
    let id = data.get("id").and_then(|v| v.as_str()).or_else(|| data.get("chat_id").and_then(|v| v.as_str())).unwrap_or("").to_string();
    let id = if id.is_empty() { format!("kick-{}-{}", username, chrono::Utc::now().timestamp_millis()) } else { id };

    Some(ChatMessage {
        id,
        author: user_id.clone(),
        author_channel_id: user_id,
        author_name: username.to_string(),
        author_handle: username.to_string(),
        author_photo: pfp,
        message: content.to_string(),
        timestamp: String::new(),
        timestamp_ms: chrono::Utc::now().timestamp_millis() as u64,
        is_super_chat: false,
        super_chat_amount: None,
        is_membership: false,
        is_moderator: false,
        is_owner: false,
        badge_url: None,
        provider: "kick".to_string(),
    })
}
