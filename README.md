# Master Games Arcade · MAME Launcher

Front-end neon retrô + backend Node local para lançar ROMs do MAME no Windows.

## Como rodar

```bat
iniciar_mame_launcher.bat
```

Esse `.bat`:
1. Sobe o backend `mame-server.js` na porta `7777`
2. Configura `rompath` no `mame.ini` via `POST /api/set-rompath`
3. Abre `http://localhost:8080/intro.html`

## Dev (front)

```bash
bun install
bun run dev
```

## Endpoints do backend

- `GET  /api/health` — status
- `GET  /api/config` — carrega config salva no servidor
- `POST /api/config` — salva config (`mamePath`, `romsDir`)
- `GET  /api/roms?path=...` — lista ROMs `.zip/.7z/.chd`
- `GET  /api/check-mame?path=...` — valida `mame.exe` e lê `rompath` do `mame.ini`
- `POST /api/set-rompath` — grava `rompath` no `mame.ini`
- `POST /api/launch` — `{ mamePath, romName }` inicia o jogo
- `GET  /api/launches` — últimas 50 execuções

## Funcionalidades

- Auto-recuperação do backend (health-check a cada 5s)
- Re-scan automático de ROMs a cada 30s
- Config persistida no servidor (`config.json`) + localStorage
- Log de execuções (`launches.log`)
- Favoritos, histórico, busca, navegação por teclado

## Arquivos ignorados pelo git

`config.json` e `launches.log` são gerados em runtime e não vão pro repositório.
