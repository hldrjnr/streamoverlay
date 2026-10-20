import React, { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { ChatPanel } from "./ChatPanel";
import { useChatStore } from "../stores/chatStore";
import { onChatMessage, onSettingsChanged, getSettings } from "../lib/tauri";

export function ChatOverlay() {
  const setSettings = useChatStore((s) => s.setSettings);
  const addMessage = useChatStore((s) => s.addMessage);
  const clearMessages = useChatStore((s) => s.clearMessages);
  const removeExpiredMessages = useChatStore((s) => s.removeExpiredMessages);
  const setConnectedProviders = useChatStore((s) => s.setConnectedProviders);
  const settings = useChatStore((s) => s.settings);
  const prevLifetimeRef = useRef(settings.message_lifetime);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const unlistenMsg = onChatMessage((msg) => {
      addMessage(msg);
    });

    const unlistenSettings = onSettingsChanged((s) => {
      setSettings(s);
    });

    const unlistenProviders = listen<string[]>("providers-changed", (e) => {
      setConnectedProviders(e.payload);
    });

    getSettings().then((s) => setSettings(s));

    return () => {
      unlistenMsg.then((fn) => fn());
      unlistenSettings.then((fn) => fn());
      unlistenProviders.then((fn) => fn());
    };
  }, []);

  // Manage message lifecycle
  useEffect(() => {
    const prev = prevLifetimeRef.current;
    prevLifetimeRef.current = settings.message_lifetime;

    // When timer is enabled (0 → N), clear all existing messages
    if (prev === 0 && settings.message_lifetime > 0) {
      clearMessages();
    }

    // Set up periodic cleanup
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (settings.message_lifetime > 0) {
      intervalRef.current = setInterval(() => {
        removeExpiredMessages(settings.message_lifetime * 1000);
      }, 500);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [settings.message_lifetime]);

  return (
    <div className="w-full h-full flex flex-col" style={{ background: "transparent" }}>
      {settings.show_overlay_frame && (
        <div
          data-tauri-drag-region
          className="titlebar h-8 w-full flex-shrink-0 cursor-grab active:cursor-grabbing flex items-center justify-center"
          style={{ backgroundColor: "rgba(255,255,255,0.03)" }}
        >
          <div className="w-10 h-1 rounded-full bg-white/10" />
        </div>
      )}
      <div className="flex-1 overflow-hidden">
        <ChatPanel />
      </div>
    </div>
  );
}
