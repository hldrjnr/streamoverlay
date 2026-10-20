import { create } from "zustand";
import type { ChatMessage, OverlaySettings } from "../lib/tauri";
import { DEFAULT_STYLE_CONFIGS } from "../lib/tauri";

export interface StoredMessage extends ChatMessage {
  _receivedAt: number;
}

interface ChatState {
  messages: StoredMessage[];
  connected: boolean;
  videoId: string | null;
  settings: OverlaySettings;
  connectedProviders: string[];

  addMessage: (message: ChatMessage) => void;
  removeExpiredMessages: (lifetimeMs: number) => void;
  setConnected: (connected: boolean, videoId?: string | null) => void;
  setSettings: (settings: OverlaySettings) => void;
  setConnectedProviders: (providers: string[]) => void;
  clearMessages: () => void;
}

const defaultSettings: OverlaySettings = {
  font_size: 14,
  font_family: "Inter, system-ui, sans-serif",
  message_color: "#ffffff",
  author_color: "#60a5fa",
  background_opacity: 0.7,
  message_spacing: 8,
  max_messages: 5,
  show_badges: true,
  show_avatars: true,
  animation_enabled: true,
  always_on_top: true,
  show_overlay_frame: true,
  message_style: "default",
  style_configs: DEFAULT_STYLE_CONFIGS,
  font_weight: "normal",
  panel_bg_color: "#000000",
  message_lifetime: 0,
  show_author_handle: false,
  skip_media_download: false,
};

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  connected: false,
  videoId: null,
  settings: defaultSettings,
  connectedProviders: [],

  addMessage: (message) =>
    set((state) => {
      const stored: StoredMessage = { ...message, _receivedAt: Date.now() };
      const max = state.settings.max_messages;
      return {
        messages: [...state.messages, stored].slice(-max),
      };
    }),

  removeExpiredMessages: (lifetimeMs) =>
    set((state) => {
      if (lifetimeMs <= 0) return state;
      const now = Date.now();
      return {
        messages: state.messages.filter(
          (m) => now - m._receivedAt < lifetimeMs
        ),
      };
    }),

  setConnected: (connected, videoId = null) =>
    set({ connected, videoId }),

  setSettings: (settings) =>
    set({ settings }),

  setConnectedProviders: (providers) =>
    set({ connectedProviders: providers }),

  clearMessages: () =>
    set({ messages: [] }),
}));
