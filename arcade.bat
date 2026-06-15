@echo off
setlocal enabledelayedexpansion
title Master Games Arcade - Build do Instalador (.exe)
color 0A

echo ============================================================
echo   MASTER GAMES ARCADE - GERADOR DO INSTALADOR (.exe)
echo ============================================================
echo.

cd /d "%~dp0"

REM ===== IDs do Google Drive (testados) =====
set "GDRIVE_MAMEPLUS_ID=1W3kgAPgrA7jC9CUxKzb-cEyjHpm_xw6H"
set "MAME_GITHUB_URL=https://github.com/mamedev/mame/releases/download/mame0288/mame0288b_x64.exe"

REM ---------- [1/7] Node.js ----------
echo [1/7] Verificando Node.js...
where node >nul 2>&1 || (
  echo   ERRO: Node.js nao encontrado. Instale Node 18+ em https://nodejs.org
  pause & exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do echo    Node %%v OK

REM ---------- [2/7] Pastas ----------
echo.
echo [2/7] Preparando pastas...
if not exist "resources\mame"      mkdir "resources\mame"
if not exist "resources\mameplus"  mkdir "resources\mameplus"
if not exist "resources\tools"     mkdir "resources\tools"

REM ---------- [3/7] 7-Zip portatil ----------
echo.
echo [3/7] Verificando 7-Zip portatil...
if not exist "resources\tools\7z.exe" (
  echo    Baixando 7zr.exe...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://www.7-zip.org/a/7zr.exe' -OutFile 'resources\tools\7z.exe' -UseBasicParsing"
  if not exist "resources\tools\7z.exe" ( echo    [ERRO] Falha ao baixar 7zr.exe & pause & exit /b 1 )
)
echo    [OK] 7z.exe

REM ---------- [4/7] MAME 0.288 (GitHub release oficial) ----------
echo.
echo [4/7] MAME 0.288...
if exist "resources\mame\mame.exe" (
  echo    [OK] ja instalado
) else (
  echo    Baixando MAME 0.288 ^(~82 MB^) do GitHub...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%MAME_GITHUB_URL%' -OutFile 'resources\mame\_mame.exe' -UseBasicParsing"
  if not exist "resources\mame\_mame.exe" ( echo    [ERRO] Download falhou & pause & exit /b 1 )
  echo    Extraindo MAME...
  "resources\tools\7z.exe" x "resources\mame\_mame.exe" -o"resources\mame" -y >nul
  del /q "resources\mame\_mame.exe" >nul 2>&1
  if not exist "resources\mame\mame.exe" ( echo    [ERRO] mame.exe nao encontrado apos extracao & pause & exit /b 1 )
  echo    [OK] MAME 0.288 instalado
)

REM ---------- [5/7] MAMEPlus 0.168 (Google Drive) ----------
echo.
echo [5/7] MAMEPlus 0.168...
if exist "resources\mameplus\mamep64.exe" (
  echo    [OK] ja instalado
) else (
  echo    Baixando MAMEPlus do Google Drive ^(~58 MB^)...
  REM -- Drive permite download direto para arquivos ^< 100MB, sem confirm token --
  powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://drive.google.com/uc?export=download&id=%GDRIVE_MAMEPLUS_ID%' -OutFile 'resources\mameplus\_mp.7z' -UseBasicParsing -MaximumRedirection 10"
  if not exist "resources\mameplus\_mp.7z" ( echo    [ERRO] Download falhou & pause & exit /b 1 )
  echo    Extraindo MAMEPlus...
  "resources\tools\7z.exe" x "resources\mameplus\_mp.7z" -o"resources\mameplus" -y >nul
  del /q "resources\mameplus\_mp.7z" >nul 2>&1
  if not exist "resources\mameplus\mamep64.exe" ( echo    [ERRO] mamep64.exe nao encontrado & pause & exit /b 1 )
  echo    [OK] MAMEPlus 0.168 instalado
)

REM ---------- [6/7] Dependencias + build ----------
echo.
echo [6/7] Instalando dependencias e buildando front-end...
if not exist "node_modules" ( call npm install || goto :err )
call npm install --save-dev electron@^31 electron-builder@^25 || goto :err
call npm run build || goto :err

REM ---------- [7/7] Empacotamento ----------
echo.
echo [7/7] Empacotando instalador NSIS x64...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":7777" ^| findstr "LISTENING"') do (
  echo    Encerrando processo na porta 7777 ^(PID %%p^)...
  taskkill /PID %%p /F >nul 2>&1
)
if exist "release" ( rmdir /s /q "release" >nul 2>&1 )
call npm run electron:build || goto :err

echo.
echo ============================================================
echo   PRONTO! Instalador gerado em: release\
echo ============================================================
dir /b release\*.exe 2>nul
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