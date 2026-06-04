@echo off
setlocal EnableDelayedExpansion
title Master Games Arcade - Setup Completo (v2)

echo.
echo ================================================
echo   Master Games Arcade - Dev Emerson
echo   Setup Completo: MAME + Attract-Mode Plus
echo   Versao 2 - Corrigida (forums + releases)
echo ================================================
echo.

:: ================================================
:: VARIAVEIS PRINCIPAIS
:: ================================================
set MAME_DIR=C:\mame
set AM_DIR=C:\AttractMode
set SCRIPT_DIR=%~dp0
set BG_SRC=%SCRIPT_DIR%master_games_bg.png

:: MAME 0.287 - GitHub Releases (asset oficial confirmado)
set MAME_FILE=mame0287b_x64.exe
set MAME_URL_GH=https://github.com/mamedev/mame/releases/download/mame0287/%MAME_FILE%
set MAME_URL_SF=https://sourceforge.net/projects/mame/files/mame/0.287/%MAME_FILE%/download
set MAME_INSTALLER=%TEMP%\%MAME_FILE%

:: CORRECAO: Attract-Mode Plus 3.2.3 - asset Windows e .7z (NAO .zip!)
:: Fonte: github.com/oomek/attractplus/releases/tag/3.2.3
set AM_VER=3.2.3
set AM_FILE=attractplus_%AM_VER%_Windows.7z
set AM_URL_GH=https://github.com/oomek/attractplus/releases/download/%AM_VER%/%AM_FILE%
set AM_ARCHIVE=%TEMP%\%AM_FILE%

:: 7zr.exe portatil para extrair .7z sem dependencia externa
:: Fonte oficial: 7-zip.org
set SEVENZR=%TEMP%\7zr.exe
set SEVENZR_URL=https://www.7-zip.org/a/7zr.exe

:: ================================================
:: VERIFICACOES INICIAIS
:: ================================================
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERRO] Execute este script como Administrador!
    echo.
    pause
    exit /b 1
)

curl.exe --version >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERRO] curl.exe nao encontrado. Necessario Windows 10 build 1803+.
    pause
    exit /b 1
)
echo [OK] curl.exe disponivel.

if exist "%BG_SRC%" (
    echo [OK] Imagem de fundo encontrada.
) else (
    echo [AVISO] master_games_bg.png nao encontrada - continuando sem fundo.
)
echo.

:: ================================================
:: PASSO 1 - MAME
:: ================================================
echo [1/4] Verificando MAME...
echo.

if exist "%MAME_DIR%\mame.exe" (
    echo [OK] MAME ja instalado em %MAME_DIR%\mame.exe
    goto MAME_CONFIG
)

if not exist "%MAME_DIR%" mkdir "%MAME_DIR%"

echo [INFO] Baixando MAME 0.287 oficial (~97MB)...
echo        Tentativa 1: GitHub Releases...
curl.exe -L --progress-bar --retry 3 --retry-delay 5 -o "%MAME_INSTALLER%" "%MAME_URL_GH%"

set MAME_SIZE=0
if exist "%MAME_INSTALLER%" for %%A in ("%MAME_INSTALLER%") do set MAME_SIZE=%%~zA
if !MAME_SIZE! GTR 10000000 goto MAME_EXTRACT

if exist "%MAME_INSTALLER%" del "%MAME_INSTALLER%" >nul 2>&1
echo [INFO] Tentativa 2: SourceForge...
curl.exe -L --progress-bar --retry 3 --retry-delay 5 -o "%MAME_INSTALLER%" "%MAME_URL_SF%"

set MAME_SIZE=0
if exist "%MAME_INSTALLER%" for %%A in ("%MAME_INSTALLER%") do set MAME_SIZE=%%~zA
if !MAME_SIZE! GTR 10000000 goto MAME_EXTRACT

echo [ERRO] Nao foi possivel baixar o MAME. Baixe manualmente:
echo        https://www.mamedev.org/release.html
pause
exit /b 1

:MAME_EXTRACT
echo [INFO] Extraindo MAME em %MAME_DIR%...
"%MAME_INSTALLER%" -o"%MAME_DIR%" -y >nul 2>&1
del "%MAME_INSTALLER%" >nul 2>&1

if exist "%MAME_DIR%\mame.exe" goto MAME_OK
if exist "%MAME_DIR%\mame64.exe" (
    rename "%MAME_DIR%\mame64.exe" "mame.exe" >nul 2>&1
    goto MAME_OK
)
echo [ERRO] Extracao falhou - mame.exe nao encontrado.
pause
exit /b 1

:MAME_OK
echo [OK] MAME instalado em %MAME_DIR%\mame.exe
echo.

:MAME_CONFIG
echo [2/4] Configurando MAME...
echo.

for %%D in (roms snap diff inp sta artwork cheat) do (
    if not exist "%MAME_DIR%\%%D" mkdir "%MAME_DIR%\%%D"
)

if exist "%MAME_DIR%\ui.ini" (
    if not exist "%MAME_DIR%\ui.ini.bak" copy /Y "%MAME_DIR%\ui.ini" "%MAME_DIR%\ui.ini.bak" >nul
)
> "%MAME_DIR%\ui.ini" (
    echo # MAME Custom Theme - Neon Verde
    echo ui_active_color           0xffffffff
    echo ui_active_bg_color        0xff000000
    echo ui_inactive_color         0xff446644
    echo ui_inactive_bg_color      0xff000000
    echo ui_selected_color         0xff00ff88
    echo ui_selected_bg_color      0xff001800
    echo ui_selected_subitem_color 0xff00cc66
    echo ui_mouseover_color        0xffff8800
    echo ui_mouseover_bg_color     0xff180800
    echo ui_border_color           0xff00ff44
    echo ui_clone_color            0xff555555
    echo ui_dipsw_color            0xff00ffff
    echo ui_gfxviewer_bg_color     0xff000000
    echo ui_unavail_color          0xff440000
    echo ui_lines                  35
    echo language                  Portuguese_Brazil
)
if not exist "%APPDATA%\mame" mkdir "%APPDATA%\mame"
copy /Y "%MAME_DIR%\ui.ini" "%APPDATA%\mame\ui.ini" >nul 2>&1

> "%MAME_DIR%\mame.ini" (
    echo # MAME INI - Master Games Arcade
    echo rompath              %MAME_DIR%\roms
    echo snapshot_directory   %MAME_DIR%\snap
    echo diff_directory       %MAME_DIR%\diff
    echo input_directory      %MAME_DIR%\inp
    echo state_directory      %MAME_DIR%\sta
    echo artwork_path         %MAME_DIR%\artwork
    echo cheat_path           %MAME_DIR%\cheat
    echo video                d3d
    echo numscreens           1
    echo window               0
    echo maximize             1
    echo keepaspect           1
    echo skip_gameinfo        1
)
echo [OK] MAME configurado!
echo.

:: ================================================
:: PASSO 3 - ATTRACT-MODE PLUS 3.2.3
:: ================================================
echo [3/4] Instalando Attract-Mode Plus %AM_VER%...
echo.

if exist "%AM_DIR%\attractplus.exe" (
    echo [OK] Attract-Mode Plus ja instalado em %AM_DIR%
    goto AM_CONFIG
)

if not exist "%AM_DIR%" mkdir "%AM_DIR%"

:: CORRECAO: baixar 7zr.exe para extrair .7z (Expand-Archive PS NAO suporta .7z
:: e corrompe ZIPs grandes do GitHub. tar nativo do Windows tambem nao extrai .7z)
echo [INFO] Baixando extrator 7zr.exe portatil...
curl.exe -L --silent --retry 3 -o "%SEVENZR%" "%SEVENZR_URL%"
if not exist "%SEVENZR%" (
    echo [ERRO] Falha ao baixar 7zr.exe de 7-zip.org
    pause
    exit /b 1
)
echo [OK] 7zr.exe baixado.

echo [INFO] Baixando Attract-Mode Plus %AM_VER% (.7z, ~20MB)...
curl.exe -L --progress-bar --retry 3 --retry-delay 5 -o "%AM_ARCHIVE%" "%AM_URL_GH%"

set AM_SIZE=0
if exist "%AM_ARCHIVE%" for %%A in ("%AM_ARCHIVE%") do set AM_SIZE=%%~zA
if !AM_SIZE! LSS 5000000 (
    echo [ERRO] Download incompleto/corrompido (tamanho: !AM_SIZE! bytes^).
    echo        Baixe manualmente: https://github.com/oomek/attractplus/releases
    if exist "%AM_ARCHIVE%" del "%AM_ARCHIVE%" >nul 2>&1
    pause
    exit /b 1
)

echo [INFO] Extraindo .7z em %AM_DIR%...
"%SEVENZR%" x "%AM_ARCHIVE%" -o"%AM_DIR%" -y >nul
if %errorLevel% neq 0 (
    echo [ERRO] Falha na extracao do .7z
    pause
    exit /b 1
)
del "%AM_ARCHIVE%" >nul 2>&1
del "%SEVENZR%"   >nul 2>&1

:: Flatten subpasta se necessario
for /d %%D in ("%AM_DIR%\attract*") do (
    if exist "%%D\attractplus.exe" (
        xcopy /E /Y /Q "%%D\*" "%AM_DIR%\" >nul 2>&1
        rmdir /S /Q "%%D" >nul 2>&1
    )
)

if not exist "%AM_DIR%\attractplus.exe" (
    echo [ERRO] attractplus.exe nao encontrado apos extracao.
    pause
    exit /b 1
)
echo [OK] Attract-Mode Plus %AM_VER% instalado!
echo.

:AM_CONFIG
echo [INFO] Configurando Attract-Mode Plus...

:: CORRECAO CRITICA: v3.2+ usa subpasta config/ para TODOS os arquivos de config
:: Fonte: github.com/oomek/attractplus/releases/tag/3.2.0 (breaking change)
set AM_CFG=%AM_DIR%\config

if not exist "%AM_CFG%"                     mkdir "%AM_CFG%"
if not exist "%AM_CFG%\romlists"            mkdir "%AM_CFG%\romlists"
if not exist "%AM_CFG%\emulators"           mkdir "%AM_CFG%\emulators"
if not exist "%AM_CFG%\layouts\MasterGames" mkdir "%AM_CFG%\layouts\MasterGames"
if not exist "%AM_CFG%\screenshots"         mkdir "%AM_CFG%\screenshots"
if not exist "%AM_CFG%\flyers"              mkdir "%AM_CFG%\flyers"

if exist "%BG_SRC%" (
    copy /Y "%BG_SRC%" "%AM_CFG%\layouts\MasterGames\bg.png" >nul
    echo [OK] Imagem de fundo copiada!
)

> "%AM_CFG%\emulators\MAME.cfg" (
    echo # Master Games Arcade - MAME Emulator Config
    echo executable           %MAME_DIR%\mame.exe
    echo args                 [name] -skip_gameinfo
    echo workdir              %MAME_DIR%
    echo rompath              %MAME_DIR%\roms
    echo romext               .zip;.7z;^<DIR^>
    echo system               Arcade
    echo info_source          listxml
    echo exit_hotkey          Escape
    echo artwork    snap      %AM_CFG%\screenshots
    echo artwork    flyer     %AM_CFG%\flyers
)
echo [OK] MAME.cfg criado em config\emulators\

> "%AM_CFG%\attract.cfg" (
    echo display
    echo 	name                  MAME
    echo 	layout                MasterGames
    echo 	romlist               MAME
    echo 	in_cycle              yes
    echo 	in_menu               yes
    echo.
    echo general
    echo 	hide_brackets         yes
    echo 	startup_mode          default
    echo 	confirm_favourites    no
    echo 	confirm_exit          no
    echo 	mouse_threshold       10
    echo 	joystick_threshold    75
    echo.
    echo input_map
    echo 	select                Return
    echo 	up                    Up
    echo 	down                  Down
    echo 	left                  Left
    echo 	right                 Right
    echo 	exit                  Escape
    echo 	add_favourite         F1
    echo 	prev_display          F3
    echo 	next_display          F4
)
echo [OK] attract.cfg criado em config\

> "%AM_CFG%\layouts\MasterGames\layout.nut" (
    echo //=============================================
    echo // Master Games Arcade - Layout Neon Verde
    echo // Dev Emerson 2026
    echo //=============================================
    echo fe.layout.width  = 1920;
    echo fe.layout.height = 1080;
    echo local flw = fe.layout.width;
    echo local flh = fe.layout.height;
    echo local bg = fe.add_image^( "bg.png", 0, 0, flw, flh ^);
    echo bg.preserve_aspect_ratio = false;
    echo local overlay = fe.add_rectangle^( 0, 0, flw, flh ^);
    echo overlay.set_rgb^( 0, 0, 0 ^);
    echo overlay.alpha = 140;
    echo local topbar = fe.add_rectangle^( 0, 0, flw, 85 ^);
    echo topbar.set_rgb^( 0, 0, 0 ^);
    echo topbar.alpha = 210;
    echo local neon_top = fe.add_rectangle^( 0, 83, flw, 4 ^);
    echo neon_top.set_rgb^( 0, 255, 100 ^);
    echo local t = fe.add_text^( "MASTER GAMES ARCADE", 0, 10, flw, 50 ^);
    echo t.align = Align.Centre;
    echo t.set_rgb^( 0, 255, 136 ^);
    echo t.font = "Arial";
    echo t.char_size = 38;
    echo t.style = Style.Bold;
    echo local s = fe.add_text^( "Dev Emerson  ^|  2026", 0, 56, flw, 28 ^);
    echo s.align = Align.Centre;
    echo s.set_rgb^( 255, 140, 0 ^);
    echo s.char_size = 20;
    echo local gn = fe.add_text^( "[Title]", 0, flh/2 - 45, flw, 55 ^);
    echo gn.align = Align.Centre;
    echo gn.set_rgb^( 255, 255, 255 ^);
    echo gn.char_size = 40;
    echo gn.style = Style.Bold;
    echo local gi = fe.add_text^( "[Manufacturer]  -  [Year]", 0, flh/2 + 20, flw, 32 ^);
    echo gi.align = Align.Centre;
    echo gi.set_rgb^( 0, 220, 100 ^);
    echo gi.char_size = 22;
    echo local gc = fe.add_text^( "[Category]", 0, flh/2 + 58, flw, 26 ^);
    echo gc.align = Align.Centre;
    echo gc.set_rgb^( 0, 180, 255 ^);
    echo gc.char_size = 18;
    echo local botbar = fe.add_rectangle^( 0, flh - 65, flw, 65 ^);
    echo botbar.set_rgb^( 0, 0, 0 ^);
    echo botbar.alpha = 210;
    echo local neon_bot = fe.add_rectangle^( 0, flh - 65, flw, 4 ^);
    echo neon_bot.set_rgb^( 0, 255, 100 ^);
    echo local pl = fe.add_text^( "Jogadores: [Players]", 20, flh - 48, 280, 30 ^);
    echo pl.align = Align.Left;
    echo pl.set_rgb^( 255, 200, 0 ^);
    echo pl.char_size = 18;
    echo local ct = fe.add_text^( "[ListEntry] / [ListSize] jogos", flw - 340, flh - 48, 320, 30 ^);
    echo ct.align = Align.Right;
    echo ct.set_rgb^( 0, 200, 255 ^);
    echo ct.char_size = 18;
    echo local hint = fe.add_text^( "ENTER Jogar     ESC Sair     Setas Navegar     F1 Favorito", 0, flh - 48, flw, 30 ^);
    echo hint.align = Align.Centre;
    echo hint.set_rgb^( 100, 100, 100 ^);
    echo hint.char_size = 16;
)
echo [OK] Layout Neon criado em config\layouts\MasterGames\
echo.

:: ================================================
:: PASSO 4 - ATALHO
:: ================================================
echo [4/4] Criando atalho na area de trabalho...
echo.

set PS1_SHORT=%TEMP%\shortcut_mg.ps1
> "%PS1_SHORT%" (
    echo $ws = New-Object -ComObject WScript.Shell
    echo $sc = $ws.CreateShortcut^("$env:USERPROFILE\Desktop\Master Games Arcade.lnk"^)
    echo $sc.TargetPath = "%AM_DIR%\attractplus.exe"
    echo $sc.WorkingDirectory = "%AM_DIR%"
    echo $sc.Description = "Master Games Arcade - Dev Emerson"
    echo $sc.Save^(^)
    echo Write-Host "[OK] Atalho criado!"
)
powershell -ExecutionPolicy Bypass -File "%PS1_SHORT%"
del "%PS1_SHORT%" >nul 2>&1

echo.
echo ================================================
echo   CONCLUIDO!
echo ================================================
echo.
echo   MAME:      %MAME_DIR%\mame.exe
echo   Launcher:  %AM_DIR%\attractplus.exe
echo   Configs:   %AM_DIR%\config\  (nova estrutura v3.2+)
echo   Atalho:    Area de Trabalho
echo.
echo   PROXIMO PASSO - Importar seus jogos:
echo   1. Coloque ROMs em: %MAME_DIR%\roms
echo   2. Abra o atalho "Master Games Arcade"
echo   3. Pressione TAB
echo   4. Va em: Emuladores ^> MAME ^> Gerar Lista de Jogos
echo.
pause
