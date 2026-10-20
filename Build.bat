@echo off
title Lovert Overlay - Build
cd /d "%~dp0"

echo ============================================
echo  Lovert Overlay - Build
echo ============================================
echo.

echo [1/3] Instalando dependencias...
call pnpm install
if %errorlevel% neq 0 (
    echo ERRO: Falha ao instalar dependencias
    pause
    exit /b 1
)

echo.
echo [2/3] Compilando frontend (TypeScript + Vite)...
call pnpm build
if %errorlevel% neq 0 (
    echo ERRO: Falha ao compilar frontend
    pause
    exit /b 1
)

echo.
echo [3/3] Compilando aplicacao Tauri (Rust)...
call pnpm tauri build
if %errorlevel% neq 0 (
    echo ERRO: Falha ao compilar aplicacao
    pause
    exit /b 1
)

echo.
echo ============================================
echo  Build concluido com sucesso!
echo  O instalador esta em src-tauri/target/release/bundle/
echo ============================================
pause
