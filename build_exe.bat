@echo off
REM ============================================================
REM Master Games Arcade - Build do .exe (Windows)
REM Roda este script no Windows com Node 18+ instalado.
REM Gera: release\MasterGamesArcade Setup x.y.z.exe (instalador NSIS)
REM ============================================================

echo.
echo [0/4] Verificando emuladores embutidos...
if not exist "resources\mame\mame.exe" (
  echo.
  echo ERRO: resources\mame\mame.exe nao encontrado.
  echo Coloque o MAME 0.288 dentro de   resources\mame\
  echo e o MAMEPlus 0.168 dentro de    resources\mameplus\
  echo antes de rodar este script.
  pause
  exit /b 1
)
if not exist "resources\mameplus\mamep64.exe" (
  echo.
  echo ERRO: resources\mameplus\mamep64.exe nao encontrado.
  echo Coloque o MAMEPlus 0.168 dentro de  resources\mameplus\
  pause
  exit /b 1
)

echo.
echo [1/4] Instalando dependencias do Electron...
call npm install --save-dev electron@^31 electron-builder@^25
if errorlevel 1 goto :err

echo.
echo [2/4] Buildando o app (vite build)...
call npm run build
if errorlevel 1 goto :err

echo.
echo [3/4] Empacotando com electron-builder (NSIS x64)...
call npm run electron:build
if errorlevel 1 goto :err

echo.
echo [4/4] Pronto! Instalador em: release\
dir /b release\*.exe
pause
exit /b 0

:err
echo.
echo ERRO durante o build. Veja a mensagem acima.
pause
exit /b 1