#!/usr/bin/env bash
# Equivalente Linux do Build.bat: dependências + frontend + Tauri (.deb)
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"

echo "============================================"
echo " Lovert Overlay - Build (Linux)"
echo "============================================"

echo "[1/3] Instalando dependencias..."
pnpm install

echo ""
echo "[2/3] Compilando frontend (TypeScript + Vite)..."
pnpm build

echo ""
echo "[3/3] Compilando aplicacao Tauri (Rust)..."
pnpm tauri build --bundles deb

echo ""
echo "============================================"
echo " Build concluido!"
echo " .deb em: src-tauri/target/release/bundle/deb/"
echo "============================================"
