#!/usr/bin/env bash
# Equivalente Linux do run.bat: modo dev (hot reload)
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"
pnpm install
pnpm tauri dev
