@echo off
setlocal enabledelayedexpansion
title Master Games Arcade - Build do .exe
color 0A

echo ============================================================
echo   MASTER GAMES ARCADE - GERADOR DO INSTALADOR (.exe)
echo ============================================================
echo.

cd /d "%~dp0"

REM ---------- [1/6] Node.js ----------
echo [1/6] Verificando Node.js...
where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo ERRO: Node.js nao encontrado no PATH.
  echo Instale Node 18+ em https://nodejs.org e rode de novo.
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do echo    Node %%v OK

REM ---------- [2/6] Emuladores embutidos ----------
echo.
echo [2/6] Verificando emuladores embutidos...
set MISSING=0
if not exist "resources\mame\mame.exe" (
  echo    [X] resources\mame\mame.exe NAO encontrado
  set MISSING=1
) else (
  echo    [OK] resources\mame\mame.exe
)
if not exist "resources\mameplus\mamep64.exe" (
  echo    [X] resources\mameplus\mamep64.exe NAO encontrado
  set MISSING=1
) else (
  echo    [OK] resources\mameplus\mamep64.exe
)
if "%MISSING%"=="1" (
  echo.
  echo ERRO: Coloque os emuladores nas pastas acima antes de continuar.
  pause
  exit /b 1
)

REM ---------- [3/6] Dependencias do app ----------
echo.
echo [3/6] Instalando dependencias do app (npm install)...
if not exist "node_modules" (
  call npm install
  if errorlevel 1 goto :err
) else (
  echo    node_modules ja existe, pulando.
)

REM ---------- [4/6] Electron + electron-builder ----------
echo.
echo [4/6] Instalando Electron + electron-builder...
call npm install --save-dev electron@^31 electron-builder@^25
if errorlevel 1 goto :err

REM ---------- [5/6] Build do front (vite) ----------
echo.
echo [5/6] Build do front-end (vite build)...
call npm run build
if errorlevel 1 goto :err

REM ---------- [6/6] Empacotamento ----------
echo.
echo [6/6] Empacotando instalador NSIS x64 (electron-builder)...
call npm run electron:build
if errorlevel 1 goto :err

echo.
echo ============================================================
echo   PRONTO! Instalador gerado em: release\
echo ============================================================
dir /b release\*.exe 2>nul
echo.
echo Abrindo a pasta release...
start "" "%cd%\release"
pause
exit /b 0

:err
echo.
echo ============================================================
echo   ERRO durante o build. Veja a mensagem acima.
echo ============================================================
pause
exit /b 1