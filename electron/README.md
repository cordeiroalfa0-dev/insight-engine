# Master Games Arcade — Build do .exe (Electron)

Como o Lovable roda em Cloudflare Workers e o Electron precisa de um host
Node real, o empacotamento do `.exe` deve ser feito **localmente no Windows**.

## Pré-requisitos

- Windows 10/11 x64
- Node.js 18 ou superior (https://nodejs.org)
- Git (opcional, só para clonar)

## Passo a passo

1. Baixe ou clone o projeto desta pasta.
2. Abra o **CMD** ou **PowerShell** dentro da pasta do projeto.
3. Rode:

   ```cmd
   build_exe.bat
   ```

   O script faz:
   - Instala `electron` e `electron-builder` como devDependencies.
   - Roda `npm run build` (vite build).
   - Roda `npm run electron:build` (gera NSIS installer x64).

4. O instalador final estará em `release\MasterGamesArcade Setup x.y.z.exe`.

## Testar antes de empacotar

Para rodar a versão Electron em modo dev (sem gerar .exe):

```cmd
npm install --save-dev electron@^31 electron-builder@^25
npm run electron:dev
```

O Electron vai abrir uma janela que:
1. Mostra `intro.html` enquanto carrega.
2. Spawna `mame-server.js` na porta 7777.
3. Spawna `vite dev` na porta 8080.
4. Carrega o launcher quando o Vite estiver pronto.

## Estrutura

- `electron/main.cjs` — Processo principal: cria janela, spawna mame-server + vite.
- `electron/preload.cjs` — Bridge segura (contextIsolation).
- `package.json` → bloco `"build"` — configuração do electron-builder (NSIS, x64,
  ícone, atalho de desktop, escolha de pasta de instalação).
- `build_exe.bat` — Atalho para rodar tudo no Windows.

## Emuladores embutidos (OBRIGATÓRIO antes do build)

Os dois emuladores são empacotados dentro do `.exe`. **Antes** de rodar
`build_exe.bat`, copie-os para:

```
resources/
  mame/mame.exe            (MAME 0.288 + arquivos auxiliares)
  mameplus/mamep64.exe     (MAMEPlus 0.168 r5272 x64 + arquivos)
```

O `package.json` já tem o `extraResources` para `resources/mame` e
`resources/mameplus`. O `electron/main.cjs` injeta `MGA_MAME_EXE` e
`MGA_MAMEPLUS_EXE` no `mame-server.js`, que resolve os binários sozinho.

**Em runtime o usuário NÃO configura caminho de emulador** — só a pasta
de ROMs. Os dois aparecem automaticamente com ● verde no seletor.

## Tamanho do instalador

- Sem emuladores: ~80 MB (Electron runtime + app).
- Com MAME + MAMEPlus: +200-400 MB dependendo do romset embutido.