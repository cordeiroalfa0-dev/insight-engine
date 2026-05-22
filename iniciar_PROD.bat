@echo off
setlocal ENABLEDELAYEDEXPANSION
title Master Games Arcade - PROD
chcp 65001 >nul

echo.
echo  ================================
echo   MASTER GAMES ARCADE [PROD]
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

:: Build de producao
echo  [1/4] Gerando build...
call npm run build
if %errorlevel% neq 0 (
    echo  [ERRO] Build falhou! Rode iniciar_DEV.bat para ver os erros.
    pause & exit /b 1
)
echo  [OK] Build gerado!

:: Backend MAME (porta 7777)
echo  [2/4] Iniciando backend (porta 7777)...
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

:: Serve build na porta 8080
echo  [3/4] Servindo build na porta 8080...
start "MAME Frontend PROD" /min cmd /c "cd /d "%PROJECT_DIR%" && npx serve dist -l 8080 --no-clipboard"

set FRONTEND_OK=0
for /l %%i in (1,1,30) do (
    if !FRONTEND_OK!==0 (
        timeout /t 1 /nobreak >nul
        curl -s http://localhost:8080 >nul 2>&1
        if !errorlevel!==0 set FRONTEND_OK=1
    )
)
if !FRONTEND_OK!==0 ( echo  [AVISO] Frontend nao respondeu, aguarde... ) else ( echo  [OK] Frontend pronto! )

:: Abre intro.html (aponta para localhost:8080)
echo  [4/4] Abrindo intro...
start "" "%PROJECT_DIR%\intro.html"

echo.
echo  ================================
echo   SERVICOS ATIVOS [PROD]:
echo   Backend : http://localhost:7777
echo   Frontend: http://localhost:8080
echo  ================================
echo.
echo  Pressione qualquer tecla para ENCERRAR tudo.
echo.
pause >nul

taskkill /fi "WindowTitle eq MAME Backend*" /f >nul 2>&1
taskkill /fi "WindowTitle eq MAME Frontend PROD*" /f >nul 2>&1
echo  Encerrado!
timeout /t 2 /nobreak >nul
endlocal
