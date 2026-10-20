use std::{collections::HashMap, sync::Arc, time::Duration};
use tauri::{AppHandle, Emitter, Manager, Position, State};
use tokio::sync::Mutex;

use crate::innertube::InnerTubeClient;
use crate::types::{default_style_configs, ConnectionStatus, OverlaySettings};
use serde_json::json;

const SETTINGS_FILE: &str = "settings.json";

pub struct AppState {
    pub client: Arc<Mutex<Option<InnerTubeClient>>>,
    pub connection_status: Arc<Mutex<ConnectionStatus>>,
    pub settings: Arc<Mutex<OverlaySettings>>,
    pub polling_handle: Arc<Mutex<Option<tokio::task::JoinHandle<()>>>>,
    pub provider_handles: Arc<Mutex<HashMap<String, tokio::task::JoinHandle<()>>>>,
}

fn load_settings(app: &AppHandle) -> OverlaySettings {
    let path = app.path().app_data_dir().ok().map(|d| d.join(SETTINGS_FILE));
    if let Some(p) = path {
        if let Ok(data) = std::fs::read_to_string(&p) {
            if let Ok(s) = serde_json::from_str(&data) {
                return s;
            }
        }
    }
    default_settings()
}

fn save_settings(app: &AppHandle, settings: &OverlaySettings) {
    if let Ok(dir) = app.path().app_data_dir() {
        let _ = std::fs::create_dir_all(&dir);
        if let Ok(data) = serde_json::to_string_pretty(settings) {
            let _ = std::fs::write(dir.join(SETTINGS_FILE), data);
        }
    }
}

fn default_settings() -> OverlaySettings {
    OverlaySettings {
        font_size: 14,
        font_family: "Inter, system-ui, sans-serif".to_string(),
        message_color: "#ffffff".to_string(),
        author_color: "#60a5fa".to_string(),
        background_opacity: 0.7,
        message_spacing: 8,
        max_messages: 5,
        show_badges: true,
        show_avatars: true,
        animation_enabled: true,
        always_on_top: true,
        show_overlay_frame: true,
        message_style: "default".to_string(),
        style_configs: default_style_configs(),
        font_weight: "normal".to_string(),
        panel_bg_color: "#000000".to_string(),
        message_lifetime: 0,
        show_author_handle: false,
        skip_media_download: false,
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            client: Arc::new(Mutex::new(None)),
            connection_status: Arc::new(Mutex::new(ConnectionStatus {
                connected: false,
                video_id: None,
                viewer_count: None,
            })),
            settings: Arc::new(Mutex::new(default_settings())),
            polling_handle: Arc::new(Mutex::new(None)),
            provider_handles: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

fn detect_provider(url: &str) -> &'static str {
    let l = url.to_lowercase();
    if l.contains("youtube.com") || l.contains("youtu.be") || l.contains("youtube-nocookie") {
        "youtube"
    } else if l.contains("twitch.tv") {
        "twitch"
    } else if l.contains("kick.com") {
        "kick"
    } else if l.contains("facebook.com") || l.contains("fb.com") || l.contains("fb.watch") {
        "facebook"
    } else if l.contains("tiktok.com") {
        "tiktok"
    } else if l.contains("instagram.com") {
        "instagram"
    } else if l.contains("trovo.live") {
        "trovo"
    } else if l.contains("rumble.com") {
        "rumble"
    } else {
        "unknown"
    }
}

#[tauri::command]
pub async fn connect_to_stream(
    url: String,
    state: State<'_, Arc<Mutex<AppState>>>,
    app: AppHandle,
) -> Result<(), String> {
    // dispatch by provider — keeps backward compat for YouTube frontend
    let provider = detect_provider(&url);
    match provider {
        "youtube" => connect_youtube(url, state, app).await,
        "twitch" => connect_twitch(url, state, app).await,
        "kick" => connect_kick(url, state, app).await,
        "facebook" => Err("Facebook Live ainda não suportado (requer token Graph API). Use YouTube/Twitch/Kick.".to_string()),
        "tiktok" => Err("TikTok Live ainda não suportado.".to_string()),
        _ => Err(format!("Provider não reconhecido para URL: {}. Suportados: YouTube, Twitch, Kick.", url)),
    }
}

#[tauri::command]
pub async fn connect_to_provider(
    url: String,
    state: State<'_, Arc<Mutex<AppState>>>,
    app: AppHandle,
) -> Result<(), String> {
    connect_to_stream(url, state, app).await
}

async fn connect_youtube(
    url: String,
    state: State<'_, Arc<Mutex<AppState>>>,
    app: AppHandle,
) -> Result<(), String> {
    // For YouTube we keep single-client behavior but don't kill Twitch/Kick handles
    {
        let state_guard = state.lock().await;
        if state_guard.client.lock().await.is_some() {
            // disconnect previous youtube only, not other providers
            if let Some(h) = state_guard.polling_handle.lock().await.take() {
                h.abort();
            }
            *state_guard.client.lock().await = None;
        }
    }

    let skip_media = {
        let state_guard = state.lock().await;
        let s = state_guard.settings.lock().await;
        s.skip_media_download
    };

    let _ = app.emit("connection-progress", json!({ "message": "Buscando página do YouTube..." }));
    let mut client = InnerTubeClient::new(skip_media);
    client.init_from_url(&url).await?;
    let _ = app.emit("connection-progress", json!({ "message": "Conectando ao chat..." }));
    let video_id = extract_video_id_from_url(&url);
    {
        let state_guard = state.lock().await;
        *state_guard.connection_status.lock().await = ConnectionStatus {
            connected: true,
            video_id: Some(video_id),
            viewer_count: None,
        };
        *state_guard.client.lock().await = Some(client);
    }
    if let Some(chat_window) = app.get_webview_window("chat") {
        let _ = chat_window.show();
        let _ = chat_window.set_focus();
    }
    let _ = app.emit("connection-progress", json!({ "message": "Conectado! Aguardando mensagens..." }));
    let state_clone = Arc::clone(&state);
    let app_clone = app.clone();
    let handle = tokio::spawn(async move {
        loop {
            let messages = {
                let state_guard = state_clone.lock().await;
                let mut client_guard = state_guard.client.lock().await;
                if let Some(ref mut client) = *client_guard {
                    match client.fetch_messages().await {
                        Ok(msgs) => msgs,
                        Err(e) => {
                            eprintln!("Erro ao buscar mensagens: {}", e);
                            let _ = app_clone.emit("chat-error", json!({ "message": e }));
                            drop(client_guard);
                            drop(state_guard);
                            tokio::time::sleep(Duration::from_secs(3)).await;
                            continue;
                        }
                    }
                } else {
                    break;
                }
            };
            for msg in messages {
                let _ = app_clone.emit("chat-message", msg);
            }
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    });
    {
        let state_guard = state.lock().await;
        *state_guard.polling_handle.lock().await = Some(handle);
    }
    Ok(())
}

async fn connect_twitch(
    url: String,
    state: State<'_, Arc<Mutex<AppState>>>,
    app: AppHandle,
) -> Result<(), String> {
    let key = format!("twitch:{}", url.to_lowercase());
    {
        let state_guard = state.lock().await;
        let handles = state_guard.provider_handles.lock().await;
        if handles.contains_key(&key) {
            return Err("Já conectado a este canal Twitch.".to_string());
        }
    }
    // validate channel quickly
    let re = regex::Regex::new(r"twitch\.tv/([a-zA-Z0-9_]{3,25})").unwrap();
    if !re.is_match(&url) && !regex::Regex::new(r"^[a-zA-Z0-9_]{3,25}$").unwrap().is_match(url.trim()) {
        return Err(format!("URL Twitch inválida: {}", url));
    }

    if let Some(w) = app.get_webview_window("chat") {
        let _ = w.show();
    }

    let app_clone = app.clone();
    let url_clone = url.clone();
    let state_clone = Arc::clone(&state);
    let key_clone = key.clone();
    let handle = tokio::spawn(async move {
        loop {
            let res = crate::twitch::run_twitch(&url_clone, app_clone.clone()).await;
            match res {
                Ok(_) => break,
                Err(e) => {
                    eprintln!("[twitch] erro: {} — reconectando em 5s", e);
                    let _ = app_clone.emit("chat-error", json!({ "message": format!("Twitch: {} (reconectar...)", e) }));
                    tokio::time::sleep(Duration::from_secs(5)).await;
                }
            }
        }
        // cleanup on exit
        let sg = state_clone.lock().await;
        sg.provider_handles.lock().await.remove(&key_clone);
    });

    {
        let state_guard = state.lock().await;
        state_guard.provider_handles.lock().await.insert(key, handle);
        // mark overall connected for UI
        let mut cs = state_guard.connection_status.lock().await;
        if !cs.connected {
            cs.connected = true;
        }
    }
    Ok(())
}

async fn connect_kick(
    url: String,
    state: State<'_, Arc<Mutex<AppState>>>,
    app: AppHandle,
) -> Result<(), String> {
    let key = format!("kick:{}", url.to_lowercase());
    {
        let state_guard = state.lock().await;
        if state_guard.provider_handles.lock().await.contains_key(&key) {
            return Err("Já conectado a este canal Kick.".to_string());
        }
    }
    if let Some(w) = app.get_webview_window("chat") {
        let _ = w.show();
    }

    let app_clone = app.clone();
    let url_clone = url.clone();
    let state_clone = Arc::clone(&state);
    let key_clone = key.clone();
    let handle = tokio::spawn(async move {
        loop {
            let res = crate::kick::run_kick(&url_clone, app_clone.clone()).await;
            match res {
                Ok(_) => break,
                Err(e) => {
                    eprintln!("[kick] erro: {} — reconectando em 5s", e);
                    let _ = app_clone.emit("chat-error", json!({ "message": format!("Kick: {} (reconectar...)", e) }));
                    tokio::time::sleep(Duration::from_secs(5)).await;
                }
            }
        }
        let sg = state_clone.lock().await;
        sg.provider_handles.lock().await.remove(&key_clone);
    });

    {
        let state_guard = state.lock().await;
        state_guard.provider_handles.lock().await.insert(key, handle);
        let mut cs = state_guard.connection_status.lock().await;
        if !cs.connected {
            cs.connected = true;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn disconnect(
    state: State<'_, Arc<Mutex<AppState>>>,
    app: AppHandle,
) -> Result<(), String> {
    let state_guard = state.lock().await;
    if let Some(handle) = state_guard.polling_handle.lock().await.take() {
        handle.abort();
    }
    // abort all provider handles (twitch/kick)
    let mut ph = state_guard.provider_handles.lock().await;
    for (_, h) in ph.drain() {
        h.abort();
    }
    drop(ph);
    *state_guard.client.lock().await = None;
    *state_guard.connection_status.lock().await = ConnectionStatus {
        connected: false,
        video_id: None,
        viewer_count: None,
    };
    if let Some(chat_window) = app.get_webview_window("chat") {
        let _ = chat_window.hide();
    }
    Ok(())
}

#[tauri::command]
pub async fn disconnect_provider(
    url: String,
    state: State<'_, Arc<Mutex<AppState>>>,
    _app: AppHandle,
) -> Result<(), String> {
    let provider = detect_provider(&url);
    let key = format!("{}:{}", provider, url.to_lowercase());
    let state_guard = state.lock().await;

    // try provider handles (twitch/kick)
    {
        let mut ph = state_guard.provider_handles.lock().await;
        if let Some(h) = ph.remove(&key) {
            h.abort();
            let is_empty = ph.is_empty();
            drop(ph);
            let has_youtube = state_guard.client.lock().await.is_some();
            if is_empty && !has_youtube {
                *state_guard.connection_status.lock().await = ConnectionStatus { connected: false, video_id: None, viewer_count: None };
            }
            return Ok(());
        }
    }

    // if url is youtube, disconnect youtube
    if provider == "youtube" {
        if let Some(h) = state_guard.polling_handle.lock().await.take() {
            h.abort();
        }
        *state_guard.client.lock().await = None;
        let is_empty = state_guard.provider_handles.lock().await.is_empty();
        if is_empty {
            *state_guard.connection_status.lock().await = ConnectionStatus { connected: false, video_id: None, viewer_count: None };
        }
        return Ok(());
    }
    Err(format!("Nenhuma conexão encontrada para {}", url))
}

#[tauri::command]
pub async fn get_connection_status(
    state: State<'_, Arc<Mutex<AppState>>>,
) -> Result<ConnectionStatus, String> {
    let state_guard = state.lock().await;
    let status = state_guard.connection_status.lock().await.clone();
    Ok(status)
}

#[tauri::command]
pub async fn get_settings(
    state: State<'_, Arc<Mutex<AppState>>>,
    app: AppHandle,
) -> Result<OverlaySettings, String> {
    let state_guard = state.lock().await;
    let mut settings = state_guard.settings.lock().await;
    let disk = load_settings(&app);
    *settings = disk.clone();
    Ok(disk)
}

#[tauri::command]
pub async fn update_settings(
    new_settings: OverlaySettings,
    state: State<'_, Arc<Mutex<AppState>>>,
    app: AppHandle,
) -> Result<(), String> {
    let state_guard = state.lock().await;
    *state_guard.settings.lock().await = new_settings.clone();
    save_settings(&app, &new_settings);
    let _ = app.emit("settings-changed", new_settings);
    Ok(())
}

#[tauri::command]
pub async fn toggle_chat_window(app: AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("chat").ok_or("Janela de chat não encontrada")?;
    if window.is_visible().unwrap_or(false) {
        window.hide().map_err(|e| e.to_string())?;
    } else {
        window.show().map_err(|e| e.to_string())?;
        let _ = window.set_focus();
    }
    Ok(())
}

#[tauri::command]
pub async fn toggle_settings_window(app: AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("settings").ok_or("Janela de configurações não encontrada")?;
    window.show().map_err(|e| e.to_string())?;
    let _ = window.set_focus();
    Ok(())
}

#[tauri::command]
pub async fn set_click_through(enabled: bool, app: AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("chat").ok_or("Janela de chat não encontrada")?;
    window.set_ignore_cursor_events(enabled).map_err(|e| e.to_string())?;
    Ok(())
}

fn extract_video_id_from_url(url: &str) -> String {
    use regex::Regex;
    let re = Regex::new(r"(?:v=|youtu\.be/|live/)([a-zA-Z0-9_-]{11})").unwrap();
    if let Some(caps) = re.captures(url) {
        return caps[1].to_string();
    }
    url.to_string()
}

#[tauri::command]
pub async fn set_always_on_top(enabled: bool, app: AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("chat").ok_or("Janela de chat não encontrada")?;
    window.set_always_on_top(enabled).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn snap_to_edge(app: AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("chat").ok_or("Janela de chat não encontrada")?;
    let monitor = window.current_monitor().map_err(|e| e.to_string())?.ok_or("Monitor não encontrado")?;
    let pos = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let mon_pos = monitor.position();
    let mon_size = monitor.size();
    let snap_threshold = 20i32;
    let wx = pos.x;
    let wy = pos.y;
    let ww = size.width as i32;
    let wh = size.height as i32;
    let mx = mon_pos.x;
    let my = mon_pos.y;
    let mw = mon_size.width as i32;
    let mh = mon_size.height as i32;
    let new_x = if (wx - mx).abs() < snap_threshold { mx } else if ((mx + mw) - (wx + ww)).abs() < snap_threshold { mx + mw - ww } else { wx };
    let new_y = if (wy - my).abs() < snap_threshold { my } else if ((my + mh) - (wy + wh)).abs() < snap_threshold { my + mh - wh } else { wy };
    if new_x != wx || new_y != wy {
        window.set_position(Position::Physical(tauri::PhysicalPosition::new(new_x, new_y))).map_err(|e| e.to_string())?;
    }
    Ok(())
}
