@echo off
title Master Games Arcade - Build Installer
chcp 65001 >nul
cd /d "%~dp0.."

echo.
echo  ============================================
echo   GERANDO INSTALADOR ONLINE (NSIS-WEB ~3MB)
echo  ============================================
echo.

if not exist node_modules (
    echo Instalando dependencias...
    call npm install
)

echo [1/3] Gerando icone a partir de public/assets/background.png...
call node scripts/make-icon.cjs
if errorlevel 1 ( echo [ERRO] Falha ao gerar icone & pause & exit /b 1 )

echo [2/3] Build do frontend (vite)...
call npm run build
if errorlevel 1 ( echo [ERRO] Falha no build & pause & exit /b 1 )

echo [3/3] Empacotando com electron-builder (NSIS instalador unico, offline)...
call npx electron-builder --win nsis --x64
if errorlevel 1 ( echo [ERRO] Falha no electron-builder & pause & exit /b 1 )

echo.
echo ============================================
echo   PRONTO! Veja a pasta electron-release\
echo ============================================
explorer electron-release
pause