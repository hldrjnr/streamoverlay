import React, { useRef, useEffect, useState } from "react";
import { ChatMessage } from "./ChatMessage";
import { useChatStore } from "../stores/chatStore";

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function ChatPanel() {
  const messages = useChatStore((s) => s.messages);
  const settings = useChatStore((s) => s.settings);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (!autoScroll) return;
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, autoScroll]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(nearBottom);
  };

  const panelBg =
    settings.background_opacity <= 0
      ? "transparent"
      : settings.panel_bg_color
      ? hexToRgba(settings.panel_bg_color, settings.background_opacity)
      : `rgba(0, 0, 0, ${settings.background_opacity})`;

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="chat-scroll h-full overflow-y-auto relative"
      style={{
        backgroundColor: panelBg,
        padding: settings.background_opacity > 0 ? "10px 10px 12px" : "4px 6px",
      }}
    >
      {messages.map((msg) => (
        <ChatMessage key={msg.id} message={msg} />
      ))}

      {!autoScroll && messages.length > 0 && (
        <button
          onClick={() => {
            setAutoScroll(true);
            if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
          }}
          className="sticky bottom-2 left-1/2 -translate-x-1/2 z-10 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold shadow-lg backdrop-blur-xl transition hover:scale-[1.02] active:scale-[0.98]"
          style={{ background: "rgba(24,24,27,0.86)", color: "white", border: "1px solid rgba(255,255,255,0.10)", boxShadow: "0 8px 24px rgba(0,0,0,0.35)" }}
        >
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          Novas mensagens
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      )}
    </div>
  );
}
