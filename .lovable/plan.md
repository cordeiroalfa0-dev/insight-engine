# Plano: corrigir crash da página + embutir emuladores no .exe

## Parte 1 — Corrigir o erro "This page didn't load"

**Causa:** em `src/routes/index.tsx` linha 9-12, o import:
```ts
import LazyLoadPkg from "react-lazy-load-image-component";
const { LazyLoadImage } = LazyLoadPkg as ...;
```
está retornando `undefined` no SSR/ESM, derrubando a página inteira com `Cannot destructure property 'LazyLoadImage' of 'LazyLoadPkg' as it is undefined`.

**Fix:** trocar pelo **named import** (que é o suportado pelo pacote em ESM):
```ts
import { LazyLoadImage } from "react-lazy-load-image-component";
```
Remover o `LazyLoadPkg` e o destructure. Sem mudança no resto do JSX.

## Parte 2 — Tirar a busca do MAME no PC; embutir tudo

### Backend (`mame-server.js`)
- Resolver os binários **só** via env injetada pelo Electron, sem aceitar paths do frontend:
  - `process.env.MGA_MAME_EXE` (fallback dev: `./resources/mame/mame.exe`)
  - `process.env.MGA_MAMEPLUS_EXE` (fallback dev: `./resources/mameplus/mamep64.exe`)
- `GET /api/emuladores` → sem query string; só retorna `{mame, mameplus}` com `exists` baseado nos paths fixos.
- `POST /api/launch` → recebe só `{ emulator, romName, showMame }`. Sem `mamePath`/`mamePlusPath`.
- `POST /api/set-rompath` e `POST /api/reset-controls` → usam o binário interno (sem `mamePath` no body).
- `GET /api/check-mame` → **removido**.
- ROM browse (`/api/browse`, `/api/roms`) → mantidos.

### Frontend (`src/routes/index.tsx`)
- **Remover** do painel de config: campos "caminho do mame.exe" e "caminho do mamep64.exe", botões SAVE associados, estados `configMamePath`/`mameExePath`/`configMamePlusPath`/`mamePlusExePath` e seu `localStorage`.
- **Manter:** seletor MAME/MAMEPlus (●/○ via `/api/emuladores`), pasta de ROMs com browse+SAVE, aviso de romsets diferentes.
- Launch envia só `{ emulator, romName, showMame }`.

### Electron (`electron/main.cjs`)
- Antes de spawnar `mame-server.js`, calcular e exportar:
  ```js
  const resBase = app.isPackaged ? process.resourcesPath : path.join(__dirname,'..','resources');
  env.MGA_MAME_EXE     = path.join(resBase,'mame','mame.exe');
  env.MGA_MAMEPLUS_EXE = path.join(resBase,'mameplus','mamep64.exe');
  ```

### Empacotamento (`package.json` → `build.extraResources`)
Acrescentar:
```json
{ "from": "resources/mame",     "to": "mame" },
{ "from": "resources/mameplus", "to": "mameplus" }
```
Mantém `mame-server.js`, `intro.html`, `intro_bg.mp4` no `asarUnpack`/`extraResources` como já estão.

### `build_exe.bat` + `electron/README.md`
- O `.bat` ganha checagem inicial: se faltar `resources\mame\mame.exe` ou `resources\mameplus\mamep64.exe`, avisa e aborta.
- README documenta: antes do build, copiar os emuladores para `resources/mame/` e `resources/mameplus/`. **Nenhum** caminho é configurado em runtime — só a pasta de ROMs.

## Resultado para o usuário
- Página volta a abrir (fim do erro do LazyLoad).
- No painel de config sobra **só** o campo "Pasta de ROMs".
- MAME e MAMEPlus já aparecem com ● verde porque vêm dentro do `.exe`.
- `build_exe.bat` gera o instalador `release\MasterGamesArcade Setup x.y.z.exe` com os dois emuladores embutidos.

## Arquivos tocados
- `src/routes/index.tsx` (fix import + remover UI de paths dos .exe)
- `mame-server.js` (resolver via env, simplificar endpoints)
- `electron/main.cjs` (injetar env com caminhos fixos)
- `package.json` (extraResources com emuladores)
- `build_exe.bat` (checagem pré-build)
- `electron/README.md` (instruções atualizadas)

Aprova pra eu implementar?
