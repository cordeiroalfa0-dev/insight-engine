@echo off
title Master Games Arcade - Iniciando...

echo.
echo  ================================
echo   MASTER GAMES ARCADE LAUNCHER
echo  ================================
echo.

set MAME_EXE=C:\Users\cordeiro\Downloads\Mameplus_0.168.2\Mameplus_0.168.2\mame.exe
set ROMS_DIR=C:\Users\cordeiro\Downloads\Mameplus_0.168.2\Mameplus_0.168.2\roms

echo  [1/3] Iniciando backend...
start "MAME Backend" /min cmd /c "cd /d "%~dp0" && node mame-server.js"

timeout /t 2 /nobreak >nul

echo  [2/3] Configurando caminhos no MAME...
curl -s -X POST http://localhost:7777/api/set-rompath ^
  -H "Content-Type: application/json" ^
  -d "{\"mamePath\":\"%MAME_EXE%\",\"romsPath\":\"%ROMS_DIR%\"}" >nul

echo  [3/3] Abrindo intro...
start http://localhost:8080/intro.html

echo.
echo  Backend rodando em http://localhost:7777
echo  Intro em http://localhost:8080/intro.html
echo.
echo  Feche esta janela quando quiser encerrar.
echo.
pause
