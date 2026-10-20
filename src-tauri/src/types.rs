use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub id: String,
    pub author: String,
    pub author_channel_id: String,
    pub author_name: String,
    pub author_handle: String,
    pub author_photo: String,
    pub message: String,
    pub timestamp: String,
    pub timestamp_ms: u64,
    pub is_super_chat: bool,
    pub super_chat_amount: Option<String>,
    pub is_membership: bool,
    pub is_moderator: bool,
    pub is_owner: bool,
    pub badge_url: Option<String>,
    #[serde(default = "default_provider")]
    pub provider: String,
}

fn default_provider() -> String { "youtube".to_string() }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionStatus {
    pub connected: bool,
    pub video_id: Option<String>,
    pub viewer_count: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StyleConfig {
    pub bg_color: String,
    pub bg_opacity: f64,
    pub border_color: String,
    pub border_width: u32,
    pub shadow: bool,
    pub shadow_color: String,
}

pub fn default_style_configs() -> HashMap<String, StyleConfig> {
    let mut m = HashMap::new();
    m.insert("default".into(), StyleConfig {
        bg_color: "#1a1a2e".into(), bg_opacity: 0.0, border_color: "#ffffff33".into(), border_width: 0, shadow: false, shadow_color: "#000000".into(),
    });
    m.insert("minimal".into(), StyleConfig {
        bg_color: "#1a1a2e".into(), bg_opacity: 0.0, border_color: "#ffffff33".into(), border_width: 0, shadow: false, shadow_color: "#000000".into(),
    });
    m.insert("bubble".into(), StyleConfig {
        bg_color: "#3b82f6".into(), bg_opacity: 0.15, border_color: "#3b82f6".into(), border_width: 1, shadow: false, shadow_color: "#000000".into(),
    });
    m.insert("pill".into(), StyleConfig {
        bg_color: "#ec4899".into(), bg_opacity: 0.12, border_color: "#ec4899".into(), border_width: 1, shadow: false, shadow_color: "#000000".into(),
    });
    m.insert("glass".into(), StyleConfig {
        bg_color: "#ffffff".into(), bg_opacity: 0.08, border_color: "#ffffff".into(), border_width: 1, shadow: false, shadow_color: "#000000".into(),
    });
    m.insert("neon".into(), StyleConfig {
        bg_color: "#00ffff".into(), bg_opacity: 0.08, border_color: "#00ffff".into(), border_width: 1, shadow: true, shadow_color: "#00ffff".into(),
    });
    m.insert("retro".into(), StyleConfig {
        bg_color: "#00ff00".into(), bg_opacity: 0.08, border_color: "#00ff00".into(), border_width: 0, shadow: true, shadow_color: "#00ff00".into(),
    });
    m.insert("glow".into(), StyleConfig {
        bg_color: "#8b5cf6".into(), bg_opacity: 0.12, border_color: "#8b5cf6".into(), border_width: 1, shadow: true, shadow_color: "#8b5cf6".into(),
    });
    m.insert("outline".into(), StyleConfig {
        bg_color: "#1a1a2e".into(), bg_opacity: 0.0, border_color: "#ffffff".into(), border_width: 1, shadow: false, shadow_color: "#000000".into(),
    });
    m
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OverlaySettings {
    pub font_size: u32,
    pub font_family: String,
    pub message_color: String,
    pub author_color: String,
    pub background_opacity: f64,
    pub message_spacing: u32,
    pub max_messages: u32,
    pub show_badges: bool,
    pub show_avatars: bool,
    pub animation_enabled: bool,
    pub always_on_top: bool,
    #[serde(default = "default_true")]
    pub show_overlay_frame: bool,
    #[serde(default = "default_message_style")]
    pub message_style: String,
    #[serde(default = "default_style_configs")]
    pub style_configs: HashMap<String, StyleConfig>,
    #[serde(default = "default_font_weight")]
    pub font_weight: String,
    #[serde(default = "default_panel_bg")]
    pub panel_bg_color: String,
    #[serde(default)]
    pub message_lifetime: u32,
    #[serde(default = "default_false")]
    pub show_author_handle: bool,
    #[serde(default)]
    pub skip_media_download: bool,
}

fn default_true() -> bool { true }
fn default_false() -> bool { false }
fn default_message_style() -> String { "default".to_string() }
fn default_font_weight() -> String { "normal".to_string() }
fn default_panel_bg() -> String { "#000000".to_string() }
