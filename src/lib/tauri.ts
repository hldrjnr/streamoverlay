import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// ── Providers ──

export const PROVIDER_IDS = [
  "youtube", "twitch", "kick", "facebook",
  "tiktok", "instagram", "trovo", "rumble",
] as const;
export type ProviderId = typeof PROVIDER_IDS[number];

export interface ProviderConfig {
  id: ProviderId | string;
  label: string;
  color: string;       // dot / accent
  bg: string;          // subtle bg for legends
  textColor?: string;
}

export const PROVIDER_CONFIG: Record<string, ProviderConfig> = {
  youtube:   { id: "youtube",   label: "YouTube",   color: "#FF0033", bg: "rgba(255,0,51,0.16)" },
  twitch:    { id: "twitch",    label: "Twitch",    color: "#9146FF", bg: "rgba(145,70,255,0.16)" },
  kick:      { id: "kick",      label: "Kick",      color: "#53FC18", bg: "rgba(83,252,24,0.16)", textColor: "#10210A" },
  facebook:  { id: "facebook",  label: "Facebook",  color: "#0866FF", bg: "rgba(8,102,255,0.16)" },
  tiktok:    { id: "tiktok",    label: "TikTok",    color: "#FE2C55", bg: "rgba(254,44,85,0.16)" },
  instagram: { id: "instagram", label: "Instagram", color: "#E1306C", bg: "rgba(225,48,108,0.16)" },
  trovo:     { id: "trovo",     label: "Trovo",     color: "#19D860", bg: "rgba(25,216,96,0.16)", textColor: "#0A2814" },
  rumble:    { id: "rumble",    label: "Rumble",    color: "#85C742", bg: "rgba(133,199,66,0.16)", textColor: "#16210A" },
};

export function getProviderConfig(provider?: string | null): ProviderConfig {
  if (!provider) return PROVIDER_CONFIG.youtube;
  const key = provider.toLowerCase();
  return PROVIDER_CONFIG[key] ?? { id: key, label: provider, color: "#9CA3AF", bg: "rgba(156,163,175,0.16)" };
}

export function getProviderDotStyle(provider?: string | null): React.CSSProperties {
  const cfg = getProviderConfig(provider);
  return {
    backgroundColor: cfg.color,
    boxShadow: `0 0 8px ${cfg.color}88, 0 0 2px ${cfg.color}`,
  };
}

export function detectProvider(url: string): string {
  const u = url.toLowerCase();
  if (/youtube\.com|youtu\.be|youtube-nocookie\.com/.test(u)) return "youtube";
  if (/twitch\.tv/.test(u)) return "twitch";
  if (/kick\.com/.test(u)) return "kick";
  if (/facebook\.com|fb\.com|fb\.watch/.test(u)) return "facebook";
  if (/tiktok\.com/.test(u)) return "tiktok";
  if (/instagram\.com/.test(u)) return "instagram";
  if (/trovo\.live/.test(u)) return "trovo";
  if (/rumble\.com/.test(u)) return "rumble";
  if (u.trim().length > 3) return "custom";
  return "youtube";
}

// ── Chat ──

export interface ChatMessage {
  id: string;
  author: string;
  author_channel_id: string;
  author_name: string;
  author_handle: string;
  author_photo: string;
  message: string;
  timestamp: string;
  timestamp_ms: number;
  is_super_chat: boolean;
  super_chat_amount: string | null;
  is_membership: boolean;
  is_moderator: boolean;
  is_owner: boolean;
  badge_url: string | null;
  provider: string; // youtube | twitch | kick | facebook | tiktok | ...
}

export interface ConnectionStatus {
  connected: boolean;
  video_id: string | null;
  viewer_count: number | null;
}

export interface StyleConfig {
  bg_color: string;
  bg_opacity: number;
  border_color: string;
  border_width: number;
  shadow: boolean;
  shadow_color: string;
}

export const STYLE_NAMES = [
  "default", "minimal", "bubble", "pill", "glass",
  "neon", "retro", "glow", "outline",
] as const;

export type MessageStyle = typeof STYLE_NAMES[number];

export const DEFAULT_STYLE_CONFIGS: Record<string, StyleConfig> = {
  default: { bg_color: "#1a1a2e", bg_opacity: 0, border_color: "#ffffff33", border_width: 0, shadow: false, shadow_color: "#000000" },
  minimal: { bg_color: "#1a1a2e", bg_opacity: 0, border_color: "#ffffff33", border_width: 0, shadow: false, shadow_color: "#000000" },
  bubble: { bg_color: "#3b82f6", bg_opacity: 0.15, border_color: "#3b82f6", border_width: 1, shadow: false, shadow_color: "#000000" },
  pill: { bg_color: "#ec4899", bg_opacity: 0.12, border_color: "#ec4899", border_width: 1, shadow: false, shadow_color: "#000000" },
  glass: { bg_color: "#ffffff", bg_opacity: 0.08, border_color: "#ffffff", border_width: 1, shadow: false, shadow_color: "#000000" },
  neon: { bg_color: "#00ffff", bg_opacity: 0.08, border_color: "#00ffff", border_width: 1, shadow: true, shadow_color: "#00ffff" },
  retro: { bg_color: "#00ff00", bg_opacity: 0.08, border_color: "#00ff00", border_width: 0, shadow: true, shadow_color: "#00ff00" },
  glow: { bg_color: "#8b5cf6", bg_opacity: 0.12, border_color: "#8b5cf6", border_width: 1, shadow: true, shadow_color: "#8b5cf6" },
  outline: { bg_color: "#1a1a2e", bg_opacity: 0, border_color: "#ffffff", border_width: 1, shadow: false, shadow_color: "#000000" },
};

export interface OverlaySettings {
  font_size: number;
  font_family: string;
  message_color: string;
  author_color: string;
  background_opacity: number;
  message_spacing: number;
  max_messages: number;
  show_badges: boolean;
  show_avatars: boolean;
  animation_enabled: boolean;
  always_on_top: boolean;
  show_overlay_frame: boolean;
  message_style: string;
  style_configs: Record<string, StyleConfig>;
  font_weight: string;
  panel_bg_color: string;
  message_lifetime: number;
  show_author_handle: boolean;
  skip_media_download: boolean;
}

export async function connectToStream(url: string): Promise<void> {
  return invoke("connect_to_stream", { url });
}

export async function connectToProvider(url: string): Promise<void> {
  return invoke("connect_to_provider", { url });
}

export async function disconnect(): Promise<void> {
  return invoke("disconnect");
}

export async function disconnectProvider(url: string): Promise<void> {
  return invoke("disconnect_provider", { url });
}

export async function getConnectionStatus(): Promise<ConnectionStatus> {
  return invoke("get_connection_status");
}

export async function getSettings(): Promise<OverlaySettings> {
  return invoke("get_settings");
}

export async function updateSettings(settings: OverlaySettings): Promise<void> {
  return invoke("update_settings", { newSettings: settings });
}

export async function toggleChatWindow(): Promise<void> {
  return invoke("toggle_chat_window");
}

export async function setAlwaysOnTop(enabled: boolean): Promise<void> {
  return invoke("set_always_on_top", { enabled });
}

export async function setClickThrough(enabled: boolean): Promise<void> {
  return invoke("set_click_through", { enabled });
}

export async function snapToEdge(): Promise<void> {
  return invoke("snap_to_edge");
}

export function onChatMessage(callback: (message: ChatMessage) => void) {
  return listen<ChatMessage>("chat-message", (event) => {
    callback(event.payload);
  });
}

export function onSettingsChanged(callback: (settings: OverlaySettings) => void) {
  return listen<OverlaySettings>("settings-changed", (event) => {
    callback(event.payload);
  });
}
