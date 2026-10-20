# Lovert Overlay (streamoverlay) — Tauri v2

Overlay de chat para transmissões ao vivo: janela transparente, sempre no topo e
clicável (ou clicável/clicável-em-cima) que mostra o chat de **YouTube, Twitch,
Kick, Facebook, TikTok, Instagram, Trovo e Rumble** direto por cima do jogo ou
do OBS.

- Duas janelas: o **overlay** (transparente, sempre no topo, ignora o mouse por
  padrão) e a **janela de comando** (configurações).
- Bandeja do sistema: mostrar/ocultar a janela de comando e sair.
- A posição/tamanho das janelas é lembrada entre execuções
  (`tauri-plugin-window-state`).
- Backend em Rust: conexão direta com YouTube (innertube), Twitch e Kick
  (`reqwest`, `tokio-tungstenite`, `scraper`) — sem processos externos.

## Instalar no Linux (Mint 22.3 / Ubuntu 24.04, x86_64)

1. Abra a aba **Actions** → **Build Lovert Overlay Linux x64**.
2. Clique em **Run workflow** (ou use a última execução verde de um push no `main`).
3. Em **Artifacts**, baixe `Lovert-Overlay-Linux-x64-deb`.
4. Instale:

   ```bash
   unzip Lovert-Overlay-Linux-x64-deb.zip
   sudo apt install ./*.deb
   ```

   O `.deb` declara as dependências (`libwebkit2gtk-4.1-0`, `libgtk-3-0`,
   `libayatana-appindicator3-1`) — o apt resolve o resto. Depois procure
   **Lovert Overlay** no menu.

As configurações ficam em `~/.local/share/com.lovertoverlay.app/`.

## Build local (Linux Mint 22.3 / Ubuntu 24.04)

```bash
# dependências de build (uma vez)
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev pkg-config libayatana-appindicator3-dev librsvg2-dev

# Node 20+ e pnpm 9/10
./build.sh    # instala deps, compila frontend + Rust e gera o .deb
./dev.sh      # modo dev com hot reload
```

O `.deb` sai em `src-tauri/target/release/bundle/deb/`. O bundling de Linux é
configurado em `src-tauri/tauri.linux.conf.json` (`targets: ["deb"]`), mesclado
automaticamente sobre o `tauri.conf.json`.

## Windows (intacto)

O projeto continua compilando como antes: `Build.bat` (gera o bundle na pasta
`src-tauri\target\release\bundle\`) e `run.bat` (modo dev). O `tauri.conf.json`
base continua com `targets: "all"` para o Windows.

## Sobreposição transparente no Linux

- A transparência precisa do **compositor** ativo — no Mint/XFCE ele já vem ligado
  (Gerenciador de Configurações do Xfce → Ajustes do gerenciador de janelas → Composição).
- Se a janela aparecer **preta** ou com falhas de renderização (comum em algumas
  GPUs/NVIDIA no WebKitGTK), rode com:

  ```bash
  WEBKIT_DISABLE_DMABUF_RENDERER=1 lovert-overlay
  ```

  (ou adicione a variável no atalho do menu).

## Estrutura

```
.github/workflows/build-linux.yml   # CI: build do .deb no ubuntu-24.04
build.sh / dev.sh                   # build e dev no Linux (equivalem a Build.bat/run.bat)
Build.bat / run.bat                 # build e dev no Windows
src/                                # frontend (React 19 + TypeScript + Tailwind + Zustand)
src-tauri/src/                      # backend Rust (commands, innertube, twitch, kick)
src-tauri/tauri.conf.json           # config base (targets "all" p/ Windows)
src-tauri/tauri.linux.conf.json     # config Linux (deb) — mesclada automaticamente
```

## Notas

- O overlay nasce **click-through** (o mouse atravessa a janela); dá para
  alternar pelo botão na janela de comando.
- Nenhuma linha do backend é específica de plataforma: o mesmo código roda no
  Windows e no Linux.
- Testes: `cargo test --manifest-path src-tauri/Cargo.toml` (roda no CI).
