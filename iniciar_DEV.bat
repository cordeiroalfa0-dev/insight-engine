@echo off
setlocal ENABLEDELAYEDEXPANSION
title Master Games Arcade - DEV
chcp 65001 >nul

echo.
echo  ================================
echo   MASTER GAMES ARCADE [DEV]
echo  ================================
echo.

set "PROJECT_DIR=%~dp0"
if "%PROJECT_DIR:~-1%"=="\" set "PROJECT_DIR=%PROJECT_DIR:~0,-1%"
cd /d "%PROJECT_DIR%"

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERRO] Node.js nao encontrado! https://nodejs.org
    pause & exit /b 1
)

if not exist "%PROJECT_DIR%\node_modules" (
    echo  Instalando dependencias...
    call npm install
    if %errorlevel% neq 0 ( echo  [ERRO] npm install falhou! & pause & exit /b 1 )
)

:: Gera intro_dev.html apontando para porta 5173
echo  [0/3] Gerando intro_dev.html...
node -e "const fs=require('fs');const src=fs.readFileSync('intro.html','utf8');fs.writeFileSync('intro_dev.html',src.replace(/localhost:8080/g,'localhost:5173'));"
if %errorlevel% neq 0 ( echo  [ERRO] Falha ao gerar intro_dev.html! & pause & exit /b 1 )
echo  [OK] intro_dev.html gerado

:: Backend MAME (porta 7777)
echo  [1/3] Iniciando backend (porta 7777)...
start "MAME Backend" /min cmd /c "cd /d "%PROJECT_DIR%" && node mame-server.js"

set BACKEND_OK=0
for /l %%i in (1,1,15) do (
    if !BACKEND_OK!==0 (
        timeout /t 1 /nobreak >nul
        curl -s http://localhost:7777/api/health >nul 2>&1
        if !errorlevel!==0 set BACKEND_OK=1
    )
)
if !BACKEND_OK!==0 ( echo  [AVISO] Backend nao respondeu ) else ( echo  [OK] Backend pronto! )

:: Frontend DEV porta 5173
echo  [2/3] Iniciando frontend DEV (porta 5173)...
start "MAME Frontend DEV" /min cmd /c "cd /d "%PROJECT_DIR%" && npx vite dev --port 5173"

echo  [2/3] Aguardando Vite na porta 5173...
set FRONTEND_OK=0
for /l %%i in (1,1,45) do (
    if !FRONTEND_OK!==0 (
        timeout /t 1 /nobreak >nul
        curl -s http://localhost:5173 >nul 2>&1
        if !errorlevel!==0 set FRONTEND_OK=1
    )
)
if !FRONTEND_OK!==0 ( echo  [AVISO] Vite demorou, abrindo assim mesmo... & timeout /t 3 /nobreak >nul ) else ( echo  [OK] Frontend pronto! )

:: Abre intro_dev.html
echo  [3/3] Abrindo intro...
start "" "%PROJECT_DIR%\intro_dev.html"

echo.
echo  ================================
echo   SERVICOS ATIVOS [DEV]:
echo   Backend : http://localhost:7777
echo   Frontend: http://localhost:5173
echo  ================================
echo.
echo  Pressione qualquer tecla para ENCERRAR tudo.
echo.
pause >nul

taskkill /fi "WindowTitle eq MAME Backend*" /f >nul 2>&1
taskkill /fi "WindowTitle eq MAME Frontend DEV*" /f >nul 2>&1
del "%PROJECT_DIR%\intro_dev.html" >nul 2>&1
echo  Encerrado!
timeout /t 2 /nobreak >nul
endlocal
