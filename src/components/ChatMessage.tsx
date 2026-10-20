import React, { useMemo, useState } from "react";
import type { ChatMessage as ChatMessageType } from "../lib/tauri";
import { useChatStore } from "../stores/chatStore";
import { getProviderConfig } from "../lib/tauri";

interface ChatMessageProps {
  message: ChatMessageType;
}

// hash -> hsl com boa saturação/luminosidade para nome
function getAuthorColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash % 360);
  // evitar vermelhos muito próximos do youtube dot -> desloca levemente
  return `hsl(${hue}, 72%, 68%)`;
}

function getMessageClasses(style: string): string {
  switch (style) {
    case "minimal": return "msg-minimal";
    case "bubble": return "msg-bubble";
    case "pill": return "msg-pill";
    case "glass": return "msg-glass";
    case "neon": return "msg-neon";
    case "retro": return "msg-retro";
    case "glow": return "msg-glow";
    case "outline": return "msg-outline";
    default: return "msg-default";
  }
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Detecta se mensagem é só emojis (permite espaços)
const EMOJI_REGEX = /(\p{Emoji_Presentation}|\p{Emoji}\uFE0F|\p{Extended_Pictographic})/u;
function isOnlyEmojis(text: string): { only: boolean; count: number } {
  const trimmed = text.trim();
  if (!trimmed) return { only: false, count: 0 };
  // remove espaços, ZWJ, variation selectors
  const withoutSpaces = trimmed.replace(/[\s\u200D\uFE0F\uFE0E]/g, "");
  if (!withoutSpaces) return { only: false, count: 0 };
  const graphemes = [...withoutSpaces];
  const emojiCount = graphemes.filter((c) => EMOJI_REGEX.test(c)).length;
  // heurística: se >60% dos chars são emoji e não tem letras/números significativos
  const hasLetters = /[a-zA-Z0-9\u00C0-\u024F\u0400-\u04FF]{2,}/.test(trimmed);
  if (hasLetters) return { only: false, count: emojiCount };
  const only = emojiCount > 0 && emojiCount / graphemes.length >= 0.6;
  return { only, count: graphemes.length };
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function ChatMessage({ message }: ChatMessageProps) {
  const settings = useChatStore((s) => s.settings);
  const connectedProviders = useChatStore((s) => s.connectedProviders);
  const [avatarError, setAvatarError] = useState(false);

  const authorColor = useMemo(() => getAuthorColor(message.author_name), [message.author_name]);
  const providerCfg = useMemo(() => getProviderConfig((message as any).provider), [(message as any).provider]);
  const emojiInfo = useMemo(() => isOnlyEmojis(message.message), [message.message]);

  // mostra pontinho/label quando há >1 link conectado (independente de mensagens)
  const hasMultipleProviders = connectedProviders.length > 1;

  const isSuperChat = message.is_super_chat;
  const isSpecial = isSuperChat || message.is_membership;
  const styleName = settings.message_style;
  const sc = settings.style_configs?.[styleName];
  const messageStyleClasses = getMessageClasses(styleName);

  const effectiveBorderWidth = sc && !isSpecial && sc.border_width > 0 ? sc.border_width : 0;
  const dynamicBg = sc && !isSpecial && sc.bg_opacity > 0 ? hexToRgba(sc.bg_color, sc.bg_opacity) : undefined;

  const showAvatar = settings.show_avatars && message.author_photo && !avatarError;

  // provider dot — só quando há 2+ providers
  const providerDot = hasMultipleProviders ? (
    <span
      title={providerCfg.label}
      aria-label={providerCfg.label}
      className={`provider-dot ${styleName === "minimal" || styleName === "pill" ? "provider-dot-lg" : ""}`}
      style={{
        backgroundColor: providerCfg.color,
        boxShadow: `0 0 8px ${providerCfg.color}99, 0 0 0 1px rgba(0,0,0,0.12)`,
        borderColor: "rgba(255,255,255,0.95)",
      }}
    />
  ) : null;

  const fontWeight =
    settings.font_weight === "bold" ? 700
    : settings.font_weight === "medium" ? 550
    : 400;

  return (
    <div
      className={`msg-card flex gap-2.5 ${messageStyleClasses} ${
        settings.animation_enabled ? "message-enter" : ""
      } ${isSuperChat ? "super-chat" : ""}`}
      style={{
        marginBottom: `${settings.message_spacing}px`,
        padding: styleName === "minimal" ? undefined : styleName === "pill" ? "7px 14px" : "10px 12px",
        ...(dynamicBg ? { background: dynamicBg, backgroundColor: dynamicBg } : {}),
        ...(effectiveBorderWidth > 0
          ? { borderWidth: `${effectiveBorderWidth}px`, borderColor: sc!.border_color, borderStyle: "solid" as const }
          : {}),
        ...(sc && sc.shadow && !isSpecial ? { boxShadow: `0 0 18px ${sc.shadow_color}55, 0 4px 16px rgba(0,0,0,0.28)` } : {}),
      }}
    >
      {/* Avatar com fallback */}
      {settings.show_avatars && (
        showAvatar ? (
          <img
            src={message.author_photo}
            alt=""
            onError={() => setAvatarError(true)}
            className="w-8 h-8 rounded-full flex-shrink-0 object-cover avatar-ring mt-0.5"
            loading="lazy"
            decoding="async"
          />
        ) : message.author_photo ? (
          <div
            className="w-8 h-8 rounded-full flex-shrink-0 avatar-ring avatar-fallback mt-0.5"
            style={{ background: `linear-gradient(135deg, ${authorColor}, ${authorColor}cc)`, fontSize: "10px" }}
          >
            {initials(message.author_name)}
          </div>
        ) : (
          <div
            className="w-8 h-8 rounded-full flex-shrink-0 avatar-ring avatar-fallback mt-0.5"
            style={{ background: `linear-gradient(135deg, ${authorColor}, ${authorColor}cc)` }}
          >
            {initials(message.author_name)}
          </div>
        )
      )}

      <div className="flex-1 min-w-0">
        {/* Header: dot + nome + badges */}
        <div className="flex items-center gap-1.5 flex-wrap leading-none mb-1">
          {providerDot}
          <span
            className={`chat-author-name font-semibold truncate max-w-[14ch] sm:max-w-[18ch] ${styleName === "retro" ? "msg-author-retro" : ""}`}
            style={{
              color: styleName === "retro" ? undefined : isSuperChat ? "#fef3c7" : authorColor,
              fontSize: "13px",
              fontWeight: styleName === "retro" ? 600 : 650,
              letterSpacing: styleName === "retro" ? "0.06em" : "-0.01em",
              lineHeight: 1.1,
            }}
            title={message.author_name}
          >
            {message.author_name}
          </span>

          {settings.show_author_handle && message.author_handle && (
            <span className="text-[11px] font-medium tracking-tight opacity-60 truncate" style={{ color: isSuperChat ? "#fde68a" : "rgba(255,255,255,0.72)" }}>
              @{message.author_handle}
            </span>
          )}

          {/* Provider label — só com 2+ providers */}
          {hasMultipleProviders && (styleName === "minimal" || styleName === "outline") && (
            <span
              className="text-[9px] font-bold tracking-widest uppercase px-1.5 py-0.5 rounded-full leading-none"
              style={{
                backgroundColor: `${providerCfg.color}18`,
                color: providerCfg.color,
                border: `1px solid ${providerCfg.color}30`,
              }}
            >
              {providerCfg.label}
            </span>
          )}

          {settings.show_badges && message.is_moderator && (
            <span className="badge-moderator text-[9px] px-1.5 py-0.5 rounded-full text-white font-bold leading-none tracking-wide">MOD</span>
          )}
          {settings.show_badges && message.is_owner && (
            <span className="badge-owner text-[9px] px-1.5 py-0.5 rounded-full text-white font-bold leading-none tracking-wide">CRIADOR</span>
          )}
          {message.is_super_chat && message.super_chat_amount && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-400 text-amber-950 font-extrabold tracking-tight leading-none shadow-sm">
              {message.super_chat_amount}
            </span>
          )}
          {message.is_membership && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 font-semibold leading-none">MEMBRO</span>
          )}
        </div>

        {/* Texto com tratamento de emoji */}
        <p
          className={`chat-message-text break-words whitespace-pre-wrap ${
            styleName === "retro" ? "msg-text-retro" : ""
          } ${emojiInfo.only ? (emojiInfo.count <= 3 ? "emoji-only-large" : "emoji-only") : ""}`}
          style={{
            color: isSuperChat ? "#fef3c7" : styleName === "retro" ? undefined : settings.message_color,
            fontSize: emojiInfo.only ? undefined : `${settings.font_size}px`,
            fontWeight: styleName === "retro" ? 400 : fontWeight,
            opacity: isSuperChat ? 1 : 0.96,
            ...(sc && sc.shadow && !isSpecial ? { textShadow: `0 1px 10px ${sc.shadow_color}66` } : {}),
          }}
        >
          {message.message}
        </p>
      </div>
    </div>
  );
}
