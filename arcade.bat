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
echo [2/6] Verificando / baixando emuladores embutidos...
if not exist "resources\mame"      mkdir "resources\mame"
if not exist "resources\mameplus"  mkdir "resources\mameplus"
if not exist "resources\tools"     mkdir "resources\tools"

REM --- 7zr.exe portatil (necessario pra extrair SFX do MAME) ---
if not exist "resources\tools\7z.exe" (
  echo    Baixando 7-Zip portatil...
  powershell -ExecutionPolicy Bypass -Command "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://www.7-zip.org/a/7zr.exe' -OutFile 'resources\tools\7z.exe' -UseBasicParsing } catch { exit 1 }"
  if not exist "resources\tools\7z.exe" (
    echo    [ERRO] Falha ao baixar 7zr.exe. Verifique sua internet.
    pause & exit /b 1
  )
)

REM --- Helper PowerShell pra baixar arquivos GRANDES do Google Drive (com confirm token) ---
REM Salvamos um .ps1 reutilizavel
if not exist "resources\tools\gdrive_dl.ps1" (
  > "resources\tools\gdrive_dl.ps1" echo param^([string]$Id,[string]$Out^)
  >>"resources\tools\gdrive_dl.ps1" echo [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
  >>"resources\tools\gdrive_dl.ps1" echo $s=New-Object Microsoft.PowerShell.Commands.WebRequestSession
  >>"resources\tools\gdrive_dl.ps1" echo $u="https://drive.google.com/uc?export=download^&id=$Id"
  >>"resources\tools\gdrive_dl.ps1" echo $r=Invoke-WebRequest -Uri $u -WebSession $s -UseBasicParsing
  >>"resources\tools\gdrive_dl.ps1" echo $tk=$null
  >>"resources\tools\gdrive_dl.ps1" echo foreach^($c in $s.Cookies.GetCookies^("https://drive.google.com"^)^){if^($c.Name -match "^download_warning"^){$tk=$c.Value}}
  >>"resources\tools\gdrive_dl.ps1" echo if^(-not $tk^){if^($r.Content -match 'confirm=([0-9A-Za-z_-]+)'^){$tk=$matches[1]}}
  >>"resources\tools\gdrive_dl.ps1" echo if^($tk^){$u="https://drive.google.com/uc?export=download^&confirm=$tk^&id=$Id"}
  >>"resources\tools\gdrive_dl.ps1" echo Invoke-WebRequest -Uri $u -WebSession $s -OutFile $Out -UseBasicParsing
)

REM --- MAME 0.288 (Google Drive - folder do usuario, baixamos como ZIP pelo file ID principal) ---
REM Folder: https://drive.google.com/drive/folders/1fqoJYknS_HmNuEbLr0zQFlSN_dZHpa8v
REM   Como pasta nao tem download direto, o usuario deve compactar a pasta como ZIP no Drive
REM   ou fornecer um file ID. Aqui assumimos que o MAME virá do release oficial como fallback.
if exist "resources\mame\mame.exe" (
  echo    [OK] resources\mame\mame.exe
) else (
  echo    Baixando MAME 0.288 do release oficial ^(~82 MB^)...
  powershell -ExecutionPolicy Bypass -Command "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://github.com/mamedev/mame/releases/download/mame0288/mame0288b_x64.exe' -OutFile 'resources\mame\_mame.exe' -UseBasicParsing } catch { exit 1 }"
  if not exist "resources\mame\_mame.exe" (
    echo    [ERRO] Falha ao baixar MAME 0.288.
    pause & exit /b 1
  )
  echo    Extraindo MAME 0.288...
  "resources\tools\7z.exe" x "resources\mame\_mame.exe" -o"resources\mame" -y >nul
  del /q "resources\mame\_mame.exe" >nul 2>&1
  if not exist "resources\mame\mame.exe" (
    echo    [ERRO] mame.exe nao encontrado apos extracao.
    pause & exit /b 1
  )
  echo    [OK] MAME 0.288 instalado
)

REM --- MAMEPlus 64 (Google Drive file: 1W3kgAPgrA7jC9CUxKzb-cEyjHpm_xw6H) ---
if exist "resources\mameplus\mamep64.exe" (
  echo    [OK] resources\mameplus\mamep64.exe
) else (
  echo    Baixando MAMEPlus 0.168 do Google Drive...
  powershell -ExecutionPolicy Bypass -File "resources\tools\gdrive_dl.ps1" -Id "1W3kgAPgrA7jC9CUxKzb-cEyjHpm_xw6H" -Out "resources\mameplus\_mameplus.zip"
  if not exist "resources\mameplus\_mameplus.zip" (
    echo    [ERRO] Falha ao baixar MAMEPlus do Google Drive.
    echo    Verifique se o link esta como "qualquer pessoa com o link pode visualizar".
    pause & exit /b 1
  )
  echo    Extraindo MAMEPlus...
  "resources\tools\7z.exe" x "resources\mameplus\_mameplus.zip" -o"resources\mameplus" -y >nul
  del /q "resources\mameplus\_mameplus.zip" >nul 2>&1
  if not exist "resources\mameplus\mamep64.exe" (
    REM Procura recursivo (zip pode ter subpasta) e move pra raiz
    for /r "resources\mameplus" %%F in (mamep64.exe) do (
      if exist "%%F" (
        echo    Movendo %%F para raiz...
        xcopy /y /e "%%~dpF*" "resources\mameplus\" >nul
        goto :mp_ok
      )
    )
    echo    [ERRO] mamep64.exe nao encontrado apos extracao.
    pause & exit /b 1
  )
  :mp_ok
  echo    [OK] MAMEPlus 0.168 instalado
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
REM Mata mame-server se estiver rodando (libera 7777 e evita lock)
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":7777" ^| findstr "LISTENING"') do (
  echo    Encerrando processo na porta 7777 (PID %%p)...
  taskkill /PID %%p /F >nul 2>&1
)
REM Limpa release\ anterior para evitar instalador stale
if exist "release" (
  echo    Limpando release\ anterior...
  rmdir /s /q "release" >nul 2>&1
)
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