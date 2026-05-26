## Objetivo

Criar um instalador Windows **enxuto (online)** do Master Games Arcade, que ao rodar:

1. Instala o app no PC do usuário
2. Permite baixar o **MAME open-source** automaticamente
3. Reconhece sozinho as pastas de `mame.exe` e `roms/` (persistido para sempre)
4. Usa o `background.png` como ícone do app e arte da janela do instalador

---

## 1. Preparar build com electron-builder (instalador NSIS online)

Trocar `electron-packager` por **electron-builder** com target `nsis-web` (web installer):

- Gera um `.exe` instalador **pequeno (~2 MB)** que baixa o pacote real (`.7z`) durante a instalação
- Configurar ícone do app e do instalador a partir de `public/assets/background.png` (convertido para `.ico` 256x256 multi-tamanho via script no build)
- `oneClick: false`, permite escolher pasta de instalação
- `perMachine: false` (instala em `%LOCALAPPDATA%`, sem precisar admin)

Arquivo novo: `build/installer.nsh` (header/branding com a imagem de fundo na janela)
Arquivo novo: `scripts/make-icon.cjs` (gera `build/icon.ico` a partir do PNG usando `png-to-ico`)

`package.json` ganha bloco `"build": { ... }` com:

```
appId: com.emerson.mastergamesarcade
productName: Master Games Arcade
nsisWeb: { oneClick:false, perMachine:false, allowToChangeInstallationDirectory:true,
           installerIcon, uninstallerIcon, installerHeader, installerSidebar }
```

E scripts: `"dist:web": "electron-builder --win nsis-web"`.

---

## 2. Persistência permanente dos caminhos

Hoje os caminhos vivem só em memória do `mame-server.js`. Vamos persistir em disco:

`mame-server.js`:

- Carrega/salva `%APPDATA%/MasterGamesArcade/config.json` com `{ mamePath, romsPath }`
- `/api/set-rompath` passa a gravar nesse arquivo
- Ao subir, lê o arquivo e usa como padrão → o usuário escolhe **uma vez** e o app lembra para sempre
- Novo endpoint `GET /api/config` para o front ler

Front (`Home.tsx`): ao montar, chama `/api/config` e pré-preenche os caminhos.

---

## 3. Auto-download do MAME open-source

Novo endpoint no `mame-server.js`:

`POST /api/install-mame { destDir }`

- Baixa o ZIP oficial mais recente do MAME ([https://github.com/mamedev/mame/releases](https://github.com/mamedev/mame/releases)) — binário Windows `mameXXXX64.exe` (self-extracting 7z)
- Salva em `destDir/mame-installer.exe`
- Executa em modo silencioso para extrair em `destDir/MAME/`
- Detecta automaticamente o `mame.exe` extraído e a pasta `roms/` (cria se não existir)
- Salva esses caminhos no `config.json` → o sistema já reconhece tudo
- Retorna progresso via SSE (`/api/install-mame/progress`)

Front: na janela de instalação (config panel) adiciona botão:

**"⬇ BAIXAR E INSTALAR MAME (OPEN SOURCE)"**

- Abre `FolderBrowser` para escolher pasta destino
- Mostra barra de progresso (download + extração)
- Ao terminar, recarrega `/api/config` e a UI já mostra ROMs disponíveis

---

## 4. Branding visual

- `public/assets/background.png` → copiado para `build/icon.png` no prebuild
- `scripts/make-icon.cjs` gera `build/icon.ico` (Windows) usado por:
  - Ícone do `.exe` final
  - Ícone da janela Electron (`electron/main.cjs`)
  - `installerIcon`, `installerHeader`, `installerSidebar` no NSIS
- Janela de instalação do app (modal de config) ganha header com `background.png` como fundo translúcido

---

## 5. Detalhes técnicos

**Por que `nsis-web` em vez de `nsis` normal?**

- `nsis` → instalador único, ~80 MB (inclui Electron + Chromium)
- `nsis-web` → stub ~2 MB, baixa o `.7z` real do GitHub Releases durante install → atende o pedido "deixe que ele baixe oque for preciso em meu pc"

**Publicação do `.7z**`: configurado para `provider: github` (basta o usuário criar release no GitHub) **ou** `provider: generic` apontando para qualquer URL.

**Download do MAME**: usado o release oficial do GitHub via API `https://api.github.com/repos/mamedev/mame/releases/latest`, filtrando asset `mame*64.exe`. Extração silenciosa com `mame-installer.exe -y -o"DEST"` (self-extract 7z).

**Persistência cross-session**: `%APPDATA%/MasterGamesArcade/config.json` sobrevive a reinstalações e updates.

---

## Arquivos a criar/editar

Criar:

- `build/installer.nsh`
- `scripts/make-icon.cjs`
- `scripts/build-installer.bat` (atalho)

Editar:

- `package.json` (deps: `electron-builder`, `png-to-ico`, `7zip-bin`; scripts; bloco `build`)
- `mame-server.js` (persistência + endpoints install-mame, config)
- `src/pages/Home.tsx` (botão instalar MAME + progresso + carregar config inicial)
- `electron/main.cjs` (usar `build/icon.ico`)
- `iniciar_PROD.bat` (mensagem sobre novo fluxo)

Posso seguir com essa implementação?sim,mas antes corrija o sistema pois cliquei nos botão e não foi para a pagina onde aparece os nomes dos jogos