import React, { useState, useEffect, useMemo } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useChatStore } from "./stores/chatStore";
import {
  connectToStream,
  connectToProvider,
  disconnect,
  disconnectProvider,
  getSettings,
  updateSettings,
  toggleChatWindow,
  setAlwaysOnTop,
  setClickThrough as setClickThroughTauri,
  snapToEdge,
  onChatMessage,
  onSettingsChanged,
  STYLE_NAMES,
  getProviderConfig,
  detectProvider,
} from "./lib/tauri";
import type { OverlaySettings, StyleConfig } from "./lib/tauri";

type ExtraProvider = { id: string; url: string; provider: string; addedAt: number };

function Toggle({ checked, onChange, label, desc }: { checked: boolean; onChange: (v: boolean) => void; label: string; desc?: string }) {
  return (
    <label className="flex items-center justify-between gap-3 py-2.5 cursor-pointer group">
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-medium text-zinc-200 group-hover:text-white">{label}</div>
        {desc && <div className="text-[11px] leading-snug text-zinc-500 pr-2">{desc}</div>}
      </div>
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={`relative inline-flex h-[20px] w-[36px] items-center rounded-full border transition-all flex-shrink-0 ${checked ? "bg-[#3b82f6] border-[#3b82f6]" : "bg-zinc-800 border-white/10"}`}>
        <span className={`inline-block h-[14px] w-[14px] rounded-full bg-white shadow transition-transform ${checked ? "translate-x-[18px]" : "translate-x-[2px]"}`} />
      </button>
    </label>
  );
}
function Slider({ value, min, max, step, onChange, label, display }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; label: string; display: string }) {
  const pct = max === min ? 0 : ((value - min) / (max - min)) * 100;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-zinc-500">{label}</span>
        <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-white/[0.06] border border-white/10 text-zinc-300">{display}</span>
      </div>
      <div className="relative h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
        <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-violet-600 to-blue-500 rounded-full" style={{ width: `${pct}%` }} />
        <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
      </div>
    </div>
  );
}
function ColorRow({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-[12px] text-zinc-400">{label}</span>
      <label className="relative flex items-center gap-2 cursor-pointer">
        <span className="text-[11px] font-mono text-zinc-500">{value}</span>
        <span className="w-6 h-6 rounded-full border border-white/15 shadow" style={{ background: value }} />
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
      </label>
    </div>
  );
}
function SectionCard({ icon, title, subtitle, children, defaultOpen = true }: { icon: React.ReactNode; title: string; subtitle?: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-2xl bg-white/[0.04] border border-white/[0.07] overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-3 px-3.5 py-3 text-left hover:bg-white/[0.02] transition-colors">
        <span className="w-7 h-7 rounded-lg bg-white/[0.06] border border-white/10 grid place-items-center text-zinc-400">{icon}</span>
        <div className="flex-1 min-w-0"><div className="text-[12px] font-semibold text-white leading-none">{title}</div>{subtitle && <div className="text-[11px] text-zinc-500 leading-none mt-1">{subtitle}</div>}</div>
        <span className={`w-6 h-6 rounded-full bg-white/5 border border-white/10 grid place-items-center text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg></span>
      </button>
      {open && <div className="px-3.5 pb-3.5 pt-3 space-y-4 border-t border-white/[0.06]">{children}</div>}
    </div>
  );
}
function PlainGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-[10px] font-semibold tracking-widest uppercase text-zinc-500 px-1">{title}</div>
      <div className="rounded-2xl bg-white/[0.03] border border-white/[0.06] px-3.5 divide-y divide-white/[0.06]">{children}</div>
    </div>
  );
}

export default function App() {
  const [url, setUrl] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [clickThrough, setClickThroughState] = useState(true);
  const [newProviderUrl, setNewProviderUrl] = useState("");
  const [extraProviders, setExtraProviders] = useState<ExtraProvider[]>([]);
  const [extraError, setExtraError] = useState("");

  const connected = useChatStore((s) => s.connected);
  const videoId = useChatStore((s) => s.videoId);
  const settings = useChatStore((s) => s.settings);
  const addMessage = useChatStore((s) => s.addMessage);
  const setConnected = useChatStore((s) => s.setConnected);
  const setSettingsStore = useChatStore((s) => s.setSettings);
  const setConnectedProviders = useChatStore((s) => s.setConnectedProviders);
  const clearMessages = useChatStore((s) => s.clearMessages);

  useEffect(() => {
    const unlistenMsg = onChatMessage((msg) => { setError(""); setProgress(""); addMessage(msg); });
    const unlistenSettings = onSettingsChanged((s) => setSettingsStore(s));
    const unlistenError = listen<{ message: string }>("chat-error", (e) => { setError(e.payload.message); setProgress(""); });
    const unlistenProgress = listen<{ message: string }>("connection-progress", (e) => { setProgress(e.payload.message); setError(""); });
    getSettings().then((s) => setSettingsStore(s));
    setClickThroughTauri(true).catch(() => {});
    return () => { unlistenMsg.then((fn) => fn()); unlistenSettings.then((fn) => fn()); unlistenError.then((fn) => fn()); unlistenProgress.then((fn) => fn()); };
  }, []);

  const handleConnect = async () => {
    if (!url.trim()) return;
    setConnecting(true); setError(""); setProgress("Iniciando conexão...");
    try { clearMessages(); await connectToStream(url); setConnected(true, extractVideoId(url)); setProgress(""); }
    catch (e: any) { const msg = typeof e === "string" ? e : e?.message || String(e); setError(msg); setConnected(false); setProgress(""); }
    finally { setConnecting(false); }
  };
  const handleDisconnect = async () => { try { await disconnect(); setConnected(false); clearMessages(); setProgress(""); } catch (e) { console.error(e); } };
  const handleAddProvider = async () => {
    const trimmed = newProviderUrl.trim(); if (!trimmed) return; setExtraError("");
    const provider = detectProvider(trimmed); const cfg = getProviderConfig(provider);
    try { new URL(trimmed); } catch { setExtraError("URL inválida. Cole o link completo da live."); return; }
    if (extraProviders.some((p) => p.url === trimmed) || url === trimmed) { setExtraError("Este link já foi adicionado."); return; }
    const entry: ExtraProvider = { id: `${provider}-${Date.now()}`, url: trimmed, provider, addedAt: Date.now() };
    setConnecting(true); setProgress(`Conectando ${cfg.label}...`);
    try {
      await connectToProvider(trimmed);
      if (provider === "youtube") setConnected(true, extractVideoId(trimmed)); else setConnected(true, trimmed);
      setExtraProviders((prev) => [...prev, entry]); setNewProviderUrl(""); setProgress(""); setError(""); setExtraError("");
    } catch (e: any) { const msg = typeof e === "string" ? e : e?.message || String(e); setExtraError(msg); setProgress(""); }
    finally { setConnecting(false); }
  };
  const removeExtraProvider = async (id: string) => {
    const target = extraProviders.find((p) => p.id === id);
    if (target) try { await disconnectProvider(target.url); } catch {}
    setExtraProviders((prev) => { const next = prev.filter((p) => p.id !== id); if (next.length === 0 && !connected) setConnected(false); return next; });
  };
  const handleRemoveMain = async () => {
    if (!url) { handleDisconnect(); return; }
    try { await disconnectProvider(url); } catch { await disconnect(); }
    setUrl(""); if (extraProviders.length === 0) setConnected(false);
  };

  const detectedNewProvider = useMemo(() => { if (!newProviderUrl.trim()) return null; return getProviderConfig(detectProvider(newProviderUrl)); }, [newProviderUrl]);
  const detectedMainProvider = useMemo(() => { if (!url.trim()) return null; return getProviderConfig(detectProvider(url)); }, [url]);
  const allProviders = useMemo(() => {
    const list: ExtraProvider[] = [];
    if (connected) list.push({ id: "main", url: url || (videoId ?? ""), provider: detectProvider(url || `https://youtube.com/watch?v=${videoId}`), addedAt: 0 });
    list.push(...extraProviders); return list;
  }, [connected, videoId, url, extraProviders]);

  useEffect(() => { const providers = allProviders.map((p) => p.provider); setConnectedProviders(providers); emit("providers-changed", providers); }, [allProviders]);

  const update = (key: keyof OverlaySettings, value: unknown) => { const u = { ...settings, [key]: value }; setSettingsStore(u); updateSettings(u); };
  const updateStyleConfig = (partial: Partial<StyleConfig>) => {
    const style = settings.message_style; const cur = settings.style_configs[style] || ({} as StyleConfig);
    const u = { ...settings, style_configs: { ...settings.style_configs, [style]: { ...cur, ...partial } as StyleConfig } };
    setSettingsStore(u); updateSettings(u);
  };
  const sc = settings.style_configs[settings.message_style];

  return (
    <div className="w-full h-screen flex flex-col bg-[#08080A] text-white overflow-hidden select-none rounded-[14px] border border-white/[0.08] shadow-[0_16px_48px_rgba(0,0,0,0.65)]">
      {/* bg glows */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[14px]">
        <div className="absolute -top-28 -right-28 w-[360px] h-[360px] rounded-full bg-[radial-gradient(circle_at_center,rgba(99,102,241,0.16),transparent_65%)] blur-2xl" />
        <div className="absolute top-32 -left-20 w-[300px] h-[300px] rounded-full bg-[radial-gradient(circle_at_center,rgba(236,72,153,0.12),transparent_65%)] blur-2xl" />
      </div>

      {/* custom titlebar — janela toda é da app, sem barra do Windows */}
      <div data-tauri-drag-region className="titlebar h-8 flex items-center justify-between px-3 bg-[#0e0e10] border-b border-white/[0.06] flex-shrink-0 rounded-t-[14px]">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-md bg-gradient-to-br from-violet-600 to-blue-600 grid place-items-center"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8"><path d="M21 11.5a8.38 8.38 0 0 1-1.9.5 4.48 4.48 0 0 0 1.95-2.47 8.6 8.6 0 0 1-2.73 1.04A4.52 4.52 0 0 0 16.5 9a4.52 4.52 0 0 0-4.5 4.5c0 .35.04.7.12 1.03A12.94 12.94 0 0 1 3.2 10.13a4.52 4.52 0 0 0 1.4 6 4.3 4.3 0 0 1-2.04-.57v.06a4.52 4.52 0 0 0 3.6 4.42 4.6 4.6 0 0 1-2.04.08 4.52 4.52 0 0 0 4.22 3.13A9.06 9.06 0 0 1 0 19.54 12.8 12.8 0 0 0 6.92 21c8.3 0 12.85-6.88 12.85-12.85l-.01-.59A9.3 9.3 0 0 0 21 5.48a8.6 8.6 0 0 1-2.6.71z" /></svg></div>
          <span className="text-[11px] font-semibold tracking-tight text-zinc-200">Lovert Overlay</span>
          <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-emerald-500 animate-pulse" : "bg-zinc-600"}`} />
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => getCurrentWindow().minimize()} className="w-7 h-6 rounded-md hover:bg-white/10 grid place-items-center text-zinc-400 hover:text-white transition-colors"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M5 12h14" /></svg></button>
          <button onClick={() => getCurrentWindow().toggleMaximize()} className="w-7 h-6 rounded-md hover:bg-white/10 grid place-items-center text-zinc-400 hover:text-white transition-colors"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="9" y="9" width="10" height="10" rx="1" /><path d="M5 15V9a2 2 0 0 1 2-2h6" /></svg></button>
          <button onClick={() => getCurrentWindow().hide()} className="w-7 h-6 rounded-md hover:bg-red-500/20 hover:text-red-300 grid place-items-center text-zinc-400 transition-colors"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M18 6L6 18M6 6l12 12" /></svg></button>
        </div>
      </div>

      {/* scrollável */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-3.5 py-4 space-y-4 relative" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.12) transparent" }}>
        {/* Conexão — único card destacado */}
        <div className="rounded-2xl bg-white/[0.05] border border-white/[0.08] overflow-hidden">
          <div className="p-3.5 space-y-3">
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <input type="text" value={connected ? newProviderUrl : url} onChange={(e) => { if (connected) { setNewProviderUrl(e.target.value); setExtraError(""); } else { setUrl(e.target.value); setError(""); } }} placeholder="youtube.com • twitch.tv • kick.com" className="w-full h-10 bg-[#0f0f12] text-white text-[12.5px] px-3 pr-24 rounded-xl border border-white/[0.08] placeholder:text-zinc-600 focus:outline-none focus:border-violet-500/40 focus:ring-4 focus:ring-violet-500/10 transition-all" onKeyDown={(e) => { if (e.key === "Enter") connected ? handleAddProvider() : handleConnect(); }} />
                {(connected ? detectedNewProvider : detectedMainProvider) && (connected ? newProviderUrl.trim() : url.trim()) && (
                  <span className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold leading-none pointer-events-none border" style={{ background: (connected ? detectedNewProvider! : detectedMainProvider!).bg, borderColor: `${(connected ? detectedNewProvider! : detectedMainProvider!).color}30`, color: (connected ? detectedNewProvider! : detectedMainProvider!).textColor ?? "white" }}>
                    <span className="w-2 h-2 rounded-full" style={{ background: (connected ? detectedNewProvider! : detectedMainProvider!).color }} />{(connected ? detectedNewProvider! : detectedMainProvider!).label}
                  </span>
                )}
              </div>
              {!connected ? (
                <button onClick={handleConnect} disabled={connecting || !url.trim()} className="h-10 px-4 bg-gradient-to-br from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 disabled:from-zinc-800 disabled:to-zinc-800 disabled:text-zinc-500 text-white text-[12px] font-semibold rounded-xl shadow-[0_4px_16px_rgba(99,102,241,0.30)] disabled:shadow-none flex items-center gap-1.5">
                  {connecting ? <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg> : null} Conectar
                </button>
              ) : (
                <button onClick={handleAddProvider} disabled={!newProviderUrl.trim() || connecting} className="h-10 px-4 bg-violet-600 hover:bg-violet-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white text-[12px] font-semibold rounded-xl">Adicionar</button>
              )}
            </div>
            {connected && allProviders.length === 1 && (
              <div className="flex items-center gap-2 px-2.5 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/15">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /><span className="text-[11px] text-emerald-300 flex-1 truncate">{videoId}</span>
                <button onClick={handleDisconnect} className="text-[11px] text-zinc-400 hover:text-red-300 px-2 py-1 rounded-full hover:bg-white/5">Desconectar</button>
              </div>
            )}
            {allProviders.length > 1 && (
              <div className="flex flex-wrap gap-1.5">
                {allProviders.map((p) => { const cfg = getProviderConfig(p.provider); const isMain = p.id === "main"; return (
                  <span key={p.id} className="inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-full text-[11px] font-medium border" style={{ background: cfg.bg, borderColor: `${cfg.color}30`, color: cfg.textColor ?? "white" }}>
                    <span className="w-2 h-2 rounded-full" style={{ background: cfg.color }} />{cfg.label}
                    <button onClick={() => isMain ? handleRemoveMain() : removeExtraProvider(p.id)} className="w-5 h-5 grid place-items-center rounded-full hover:bg-black/20"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg></button>
                  </span> );})}
              </div>
            )}
            {progress && <div className="flex items-center gap-2 text-[11px] text-blue-200 bg-blue-500/10 border border-blue-500/15 rounded-xl px-3 py-2"><svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg><span className="truncate">{progress}</span></div>}
            {(error || extraError) && <div className="flex items-center gap-2 text-[11px] text-red-200 bg-red-500/10 border border-red-500/15 rounded-xl px-3 py-2"><span className="truncate flex-1">{error || extraError}</span><button onClick={() => { setError(""); setExtraError(""); }} className="text-red-300">×</button></div>}
          </div>
        </div>

        {/* Janela — sem card isolado, grupo leve */}
        <PlainGroup title="Janela">
          <div className="flex gap-2 py-2">
            <button onClick={() => toggleChatWindow()} className="flex-1 h-8 rounded-lg bg-white/[0.06] hover:bg-white/10 border border-white/10 text-[11px] font-medium text-zinc-300">Mostrar / Ocultar</button>
            <button onClick={() => snapToEdge()} className="flex-1 h-8 rounded-lg bg-white/[0.06] hover:bg-white/10 border border-white/10 text-[11px] font-medium text-zinc-300">Colar na borda</button>
          </div>
          <Toggle checked={settings.always_on_top} onChange={(v) => { update("always_on_top", v); setAlwaysOnTop(v); }} label="Sempre no topo" />
          <Toggle checked={clickThrough} onChange={(v) => { setClickThroughState(v); setClickThroughTauri(v); }} label="Click-through" desc="Ativo por padrão — clique passa através do overlay" />
          <Toggle checked={settings.show_overlay_frame} onChange={(v) => update("show_overlay_frame", v)} label="Alça de arrasto" />
        </PlainGroup>

        {/* Personalização — único bloco, sem isolar cada slider */}
        <div className="rounded-2xl bg-white/[0.04] border border-white/[0.07] divide-y divide-white/[0.06]">
          <div className="px-3.5 py-3">
            <div className="text-[12px] font-semibold text-white">Personalização</div>
            <div className="text-[11px] text-zinc-500">Aparência e leitura do chat</div>
          </div>
          <div className="px-3.5 py-3 space-y-4">
            <Slider value={settings.background_opacity} min={0} max={1} step={0.05} onChange={(v) => update("background_opacity", v)} label="Opacidade do painel" display={`${Math.round(settings.background_opacity * 100)}%`} />
            <div className="grid grid-cols-2 gap-3">
              <ColorRow value={settings.panel_bg_color} onChange={(v) => update("panel_bg_color", v)} label="Fundo" />
              <ColorRow value={settings.message_color} onChange={(v) => update("message_color", v)} label="Texto" />
            </div>
          </div>
          <div className="px-3.5 py-3 space-y-3">
            <div className="text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">Tipografia</div>
            <Slider value={settings.font_size} min={10} max={24} step={1} onChange={(v) => update("font_size", v)} label="Tamanho" display={`${settings.font_size}px`} />
            <div className="flex gap-1.5 p-1 rounded-xl bg-black/20 border border-white/5">
              {(["normal","medium","bold"] as const).map((w) => (
                <button key={w} onClick={() => update("font_weight", w)} className={`flex-1 h-7 rounded-lg text-[11px] font-semibold capitalize ${settings.font_weight===w ? "bg-white text-zinc-900" : "text-zinc-500 hover:text-zinc-300"}`}>{w}</button>
              ))}
            </div>
          </div>
          <div className="px-3.5 py-3 space-y-3">
            <div className="text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">Espaçamento</div>
            <div className="grid grid-cols-2 gap-4">
              <Slider value={settings.message_spacing} min={2} max={16} step={1} onChange={(v) => update("message_spacing", v)} label="Entre msgs" display={`${settings.message_spacing}px`} />
              <Slider value={settings.max_messages} min={1} max={50} step={1} onChange={(v) => update("max_messages", v)} label="Máx. na tela" display={`${settings.max_messages}`} />
            </div>
            <Slider value={settings.message_lifetime} min={0} max={60} step={5} onChange={(v) => update("message_lifetime", v)} label="Tempo de vida" display={settings.message_lifetime===0 ? "Sempre" : `${settings.message_lifetime}s`} />
          </div>
        </div>

        {/* Estilo — mantém card porque tem 9 opções */}
        <SectionCard icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></svg>} title="Estilo das mensagens" subtitle="9 estilos • cores e brilho">
          <div className="grid grid-cols-3 gap-1.5">
            {STYLE_NAMES.map((s) => (
              <button key={s} onClick={() => update("message_style", s)} className={`h-9 rounded-xl text-[11px] font-semibold capitalize border ${settings.message_style === s ? "bg-white text-zinc-900 border-white" : "bg-white/[0.06] text-zinc-400 border-white/10 hover:bg-white/[0.10]"}`}>{s}</button>
            ))}
          </div>
          {sc && (
            <div className="rounded-xl bg-black/30 border border-white/[0.06] p-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <ColorRow value={sc.bg_color} onChange={(v) => updateStyleConfig({ bg_color: v })} label="Fundo estilo" />
                <ColorRow value={sc.border_color} onChange={(v) => updateStyleConfig({ border_color: v })} label="Borda" />
              </div>
              <Slider value={sc.bg_opacity} min={0} max={1} step={0.05} onChange={(v) => updateStyleConfig({ bg_opacity: v })} label="Opacidade" display={`${Math.round(sc.bg_opacity * 100)}%`} />
              <Slider value={sc.border_width} min={0} max={4} step={1} onChange={(v) => updateStyleConfig({ border_width: v })} label="Borda" display={`${sc.border_width}px`} />
              <Toggle checked={sc.shadow} onChange={(v) => updateStyleConfig({ shadow: v })} label="Sombra / brilho" />
              {sc.shadow && <ColorRow value={sc.shadow_color} onChange={(v) => updateStyleConfig({ shadow_color: v })} label="Cor do brilho" />}
            </div>
          )}
        </SectionCard>

        {/* Chat — toggles sem card isolado extra */}
        <PlainGroup title="Chat">
          <Toggle checked={settings.show_badges} onChange={(v) => update("show_badges", v)} label="Badges MOD / Owner" />
          <Toggle checked={settings.show_avatars} onChange={(v) => update("show_avatars", v)} label="Avatares" />
          <Toggle checked={settings.show_author_handle} onChange={(v) => update("show_author_handle", v)} label="Mostrar @handle" />
          <Toggle checked={settings.animation_enabled} onChange={(v) => update("animation_enabled", v)} label="Animações" />
          <Toggle checked={settings.skip_media_download} onChange={(v) => update("skip_media_download", v)} label="Modo econômico" desc="Sem avatares — para internet lenta" />
        </PlainGroup>

        <div className="text-center text-[10px] text-zinc-600 pb-2">Lovert Overlay • {allProviders.length>0 ? `${allProviders.length} provedor${allProviders.length>1?"es":""} • ${settings.message_style}` : "desconectado"}</div>
      </div>
    </div>
  );
}

function extractVideoId(url: string): string {
  const m = url.match(/(?:v=|youtu\.be\/|live\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : url;
}
