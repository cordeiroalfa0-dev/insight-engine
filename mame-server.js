/**
 * MAME Local Backend Server - v3
 * Correção: spawn com shell:true para garantir execução no Windows
 */

import http from "http";
import { spawn, execFile } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const PORT = 7777;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = path.join(__dirname, "config.json");
const LOG_FILE = path.join(__dirname, "launches.log");

// Emuladores embutidos. Em produção (Electron) os caminhos vêm via env
// MGA_MAME_EXE / MGA_MAMEPLUS_EXE injetadas pelo main.cjs. Em dev usamos
// resources/<emu>/ ao lado do projeto. Nada é descoberto no PC do usuário.
function resolveEmu(envVar, relPath) {
  const candidates = [];
  if (process.env[envVar]) candidates.push(process.env[envVar]);
  candidates.push(path.join(__dirname, "resources", ...relPath));
  for (const c of candidates) {
    try {
      const abs = path.resolve(c);
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
    } catch { /* noop */ }
  }
  return "";
}
function getMameExe()     { return resolveEmu("MGA_MAME_EXE",     ["mame", "mame.exe"]); }
function getMamePlusExe() { return resolveEmu("MGA_MAMEPLUS_EXE", ["mameplus", "mamep64.exe"]); }

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")); } catch { return {}; }
}
function writeConfig(data) {
  try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2), "utf8"); return true; } catch { return false; }
}
function appendLog(entry) {
  try { fs.appendFileSync(LOG_FILE, JSON.stringify({ ts: Date.now(), ...entry }) + "\n", "utf8"); } catch {}
}

function json(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error("JSON inválido")); }
    });
  });
}

function readMameIni(mameDir) {
  const iniPath = path.join(mameDir, "mame.ini");
  if (!fs.existsSync(iniPath)) return {};
  const lines = fs.readFileSync(iniPath, "utf8").split(/\r?\n/);
  const cfg = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const spaceIdx = trimmed.search(/\s/);
    if (spaceIdx === -1) continue;
    cfg[trimmed.slice(0, spaceIdx).trim()] = trimmed.slice(spaceIdx).trim();
  }
  return cfg;
}

function writeMameIniKey(mameDir, key, value) {
  const iniPath = path.join(mameDir, "mame.ini");
  let content = fs.existsSync(iniPath) ? fs.readFileSync(iniPath, "utf8") : "";
  const lines = content.split(/\r?\n/);
  let found = false;
  const newLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;
    const spaceIdx = trimmed.search(/\s/);
    if (spaceIdx === -1) return line;
    if (trimmed.slice(0, spaceIdx).trim() === key) {
      found = true;
      return `${key}                     ${value}`;
    }
    return line;
  });
  if (!found) newLines.push(`${key}                     ${value}`);
  fs.writeFileSync(iniPath, newLines.join("\r\n"), "utf8");
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === "OPTIONS") { json(res, 204, {}); return; }

  // GET /api/health
  if (req.method === "GET" && url.pathname === "/api/health") {
    json(res, 200, { ok: true, port: PORT, version: "v8.0", emulators: ["mame", "mameplus"], bundled: true });
    return;
  }

  // GET /api/browse?path=...&mode=dir|exe
  // Lista pastas (e opcionalmente .exe) para navegação. Sem path => lista drives no Windows.
  if (req.method === "GET" && url.pathname === "/api/browse") {
    const reqPath = (url.searchParams.get("path") || "").trim();
    const mode = (url.searchParams.get("mode") || "dir").trim(); // "dir" ou "exe"
    try {
      // Sem path: lista drives (Windows) ou raiz (unix)
      if (!reqPath) {
        if (process.platform === "win32") {
          const drives = [];
          for (const letter of "CDEFGHIJKLMNOPQRSTUVWXYZAB") {
            const drive = `${letter}:\\`;
            try { if (fs.existsSync(drive)) drives.push({ name: drive, path: drive, type: "drive" }); } catch {}
          }
          json(res, 200, { path: "", parent: null, entries: drives });
        } else {
          const entries = fs.readdirSync("/").map((n) => ({ name: n, path: `/${n}`, type: "dir" }));
          json(res, 200, { path: "/", parent: null, entries });
        }
        return;
      }
      const normalized = path.resolve(reqPath);
      if (!fs.existsSync(normalized)) { json(res, 404, { error: `Pasta não encontrada: ${normalized}` }); return; }
      const stat = fs.statSync(normalized);
      if (!stat.isDirectory()) { json(res, 400, { error: "O caminho não é uma pasta" }); return; }
      const items = fs.readdirSync(normalized, { withFileTypes: true });
      const entries = [];
      for (const it of items) {
        try {
          if (it.isDirectory()) entries.push({ name: it.name, path: path.join(normalized, it.name), type: "dir" });
          else if (mode === "exe" && /\.exe$/i.test(it.name)) entries.push({ name: it.name, path: path.join(normalized, it.name), type: "exe" });
        } catch {}
      }
      entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
      const parent = path.dirname(normalized);
      json(res, 200, { path: normalized, parent: parent === normalized ? null : parent, entries });
    } catch (err) {
      json(res, 500, { error: `Erro ao listar: ${err.message}` });
    }
    return;
  }



  // GET /api/config — carrega config persistida no servidor
  if (req.method === "GET" && url.pathname === "/api/config") {
    json(res, 200, readConfig());
    return;
  }

  // POST /api/config — salva config no servidor (sobrevive a outro navegador/PC)
  if (req.method === "POST" && url.pathname === "/api/config") {
    let body;
    try { body = await parseBody(req); } catch { json(res, 400, { error: "JSON inválido" }); return; }
    const ok = writeConfig({ ...readConfig(), ...body, updatedAt: Date.now() });
    json(res, ok ? 200 : 500, ok ? { ok: true } : { error: "Falha ao salvar config.json" });
    return;
  }

  // GET /api/launches — últimas 50 execuções
  if (req.method === "GET" && url.pathname === "/api/launches") {
    try {
      const content = fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE, "utf8") : "";
      const lines = content.trim().split("\n").filter(Boolean).slice(-50).reverse();
      json(res, 200, { launches: lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) });
    } catch (err) { json(res, 500, { error: err.message }); }
    return;
  }

  // GET /api/roms?path=...
  if (req.method === "GET" && url.pathname === "/api/roms") {
    const romsPath = url.searchParams.get("path") || "";
    if (!romsPath) { json(res, 400, { error: "Parâmetro 'path' obrigatório" }); return; }
    const normalizedPath = path.resolve(romsPath.trim());
    if (!fs.existsSync(normalizedPath)) {
      json(res, 404, { error: `Pasta não encontrada: ${normalizedPath}` }); return;
    }
    try {
      const roms = fs.readdirSync(normalizedPath)
        .filter((f) => /\.(zip|7z|chd)$/i.test(f))
        .sort((a, b) => a.localeCompare(b));
      json(res, 200, { roms, path: normalizedPath, total: roms.length });
    } catch (err) {
      json(res, 500, { error: `Erro ao ler pasta: ${err.message}` });
    }
    return;
  }

  // GET /api/emuladores — verifica os emuladores EMBUTIDOS no app (sem busca no PC)
  if (req.method === "GET" && url.pathname === "/api/emuladores") {
    const mameResolved = getMameExe();
    const mamePlusResolved = getMamePlusExe();
    json(res, 200, {
      mame: { id: "mame", label: "MAME 0.288", path: mameResolved, exists: !!mameResolved },
      mameplus: { id: "mameplus", label: "MAMEPlus 0.168", path: mamePlusResolved, exists: !!mamePlusResolved },
    });
    return;
  }

  // POST /api/set-rompath
  if (req.method === "POST" && url.pathname === "/api/set-rompath") {
    let body;
    try { body = await parseBody(req); } catch { json(res, 400, { error: "JSON inválido" }); return; }
    const { romsPath } = body;
    if (!romsPath) { json(res, 400, { error: "romsPath obrigatório" }); return; }
    const mameExe = getMameExe();
    if (!mameExe) { json(res, 404, { error: "MAME embutido não encontrado nos recursos do app" }); return; }
    const mameDir = path.dirname(mameExe);
    const romsDir = path.resolve(romsPath.trim());
    const iniPath = path.join(mameDir, "mame.ini");
    if (!fs.existsSync(iniPath)) {
      console.log("[MAME] Criando mame.ini com -createconfig...");
      await new Promise((resolve) => {
        execFile(mameExe, ["-createconfig"], { cwd: mameDir }, () => resolve());
      });
    }
    try {
      writeMameIniKey(mameDir, "rompath", romsDir);
      console.log(`[MAME] rompath salvo no mame.ini: ${romsDir}`);
      json(res, 200, { ok: true, iniPath, rompath: romsDir });
    } catch (err) {
      json(res, 500, { error: `Falha ao escrever mame.ini: ${err.message}` });
    }
    return;
  }

  // POST /api/reset-controls
  // Escreve cfg/default.cfg com mapeamento de TECLADO padrão para todas as ROMs.
  if (req.method === "POST" && url.pathname === "/api/reset-controls") {
    try { await parseBody(req); } catch { /* body opcional */ }
    const mameExe = getMameExe();
    if (!mameExe) { json(res, 404, { error: "MAME embutido não encontrado nos recursos do app" }); return; }
    const mameDir = path.dirname(mameExe);
    const cfgDir = path.join(mameDir, "cfg");
    try {
      if (!fs.existsSync(cfgDir)) fs.mkdirSync(cfgDir, { recursive: true });
      // Mapeamento de teclado universal (P1 + P2 + sistema). Aplica-se a TODAS as ROMs
      // via cfg/default.cfg do MAME. Botões 1-6 funcionam como:
      //   Luta (SF, KOF, MK):   1/2/3 = soco fraco/medio/forte, 4/5/6 = chute fraco/medio/forte
      //   Beat'em up (CPS):     1 = soco, 2 = pulo, 3 = especial
      //   Shoot'em up (1942):   1 = tiro, 2 = bomba/auto-fire, 3 = especial
      // Como BUTTONn e generico no MAME, a mesma tecla mapeia em todos os generos.
      const map = [
        // Sistema
        ["UI_CANCEL",       "KEYCODE_ESC"],
        ["START1",          "KEYCODE_1"],
        ["START2",          "KEYCODE_2"],
        ["COIN1",           "KEYCODE_5"],
        ["COIN2",           "KEYCODE_6"],
        // P1 — Setas + linha A/S/D (socos/tiros) + linha Z/X/C (chutes)
        ["P1_JOYSTICK_UP",    "KEYCODE_UP"],
        ["P1_JOYSTICK_DOWN",  "KEYCODE_DOWN"],
        ["P1_JOYSTICK_LEFT",  "KEYCODE_LEFT"],
        ["P1_JOYSTICK_RIGHT", "KEYCODE_RIGHT"],
        ["P1_BUTTON1",      "KEYCODE_A"],   // Soco fraco / Tiro
        ["P1_BUTTON2",      "KEYCODE_S"],   // Soco medio / Bomba
        ["P1_BUTTON3",      "KEYCODE_D"],   // Soco forte / Especial
        ["P1_BUTTON4",      "KEYCODE_Z"],   // Chute fraco
        ["P1_BUTTON5",      "KEYCODE_X"],   // Chute medio
        ["P1_BUTTON6",      "KEYCODE_C"],   // Chute forte
        // P2 — numpad 8/2/4/6 (direcao) + Q/W/E (socos) + R/T/Y (chutes)
        // Evita colisao com o mapeamento do P1 (A S D Z X C + setas).
        ["P2_JOYSTICK_UP",    "KEYCODE_8_PAD"],
        ["P2_JOYSTICK_DOWN",  "KEYCODE_2_PAD"],
        ["P2_JOYSTICK_LEFT",  "KEYCODE_4_PAD"],
        ["P2_JOYSTICK_RIGHT", "KEYCODE_6_PAD"],
        ["P2_BUTTON1",      "KEYCODE_Q"],   // Soco fraco / Tiro
        ["P2_BUTTON2",      "KEYCODE_W"],   // Soco medio / Bomba
        ["P2_BUTTON3",      "KEYCODE_E"],   // Soco forte / Especial
        ["P2_BUTTON4",      "KEYCODE_R"],   // Chute fraco
        ["P2_BUTTON5",      "KEYCODE_T"],   // Chute medio
        ["P2_BUTTON6",      "KEYCODE_Y"],   // Chute forte
      ];
      const ports = map.map(([t, k]) => `            <port type="${t}"><newseq type="standard">${k}</newseq></port>`).join("\n");
      const xml = `<?xml version="1.0"?>
<mameconfig version="10">
    <system name="default">
        <input>
${ports}
        </input>
    </system>
</mameconfig>
`;
      fs.writeFileSync(path.join(cfgDir, "default.cfg"), xml, "utf8");
      // Apaga cfgs por-rom para garantir que o default valha em todas
      try {
        for (const f of fs.readdirSync(cfgDir)) {
          if (f.toLowerCase() !== "default.cfg" && /\.cfg$/i.test(f)) {
            try { fs.unlinkSync(path.join(cfgDir, f)); } catch {}
          }
        }
      } catch {}
      console.log(`[MAME] Teclado padrão aplicado em ${cfgDir}`);
      json(res, 200, { ok: true, cfgDir, mappings: map.length });
    } catch (err) {
      json(res, 500, { error: `Falha ao escrever default.cfg: ${err.message}` });
    }
    return;
  }

  // POST /api/launch  { emulator?, romName, showMame? }
  if (req.method === "POST" && url.pathname === "/api/launch") {
    let body;
    try { body = await parseBody(req); } catch { json(res, 400, { error: "JSON inválido" }); return; }
    const { emulator, romName, showMame } = body;
    if (!romName) { json(res, 400, { error: "romName obrigatório" }); return; }

    // Resolve o binario embutido (sem ler caminhos do frontend)
    const mameExe = emulator === "mameplus" ? getMamePlusExe() : getMameExe();
    if (!mameExe) {
      json(res, 404, { error: `MAME não encontrado: ${mameExe}` }); return;
    }

    const mameDir = path.dirname(mameExe);
    const rom = romName.replace(/\.(zip|7z|chd)$/i, "");

    // Flags: por padrão NÃO mostra UI/menu do MAME, vai direto ao jogo em fullscreen.
    // -skip_gameinfo: pula a tela de info
    // -nogameinfo / -skip_warnings: silencia avisos
    // Se showMame=true → abre em janela visível com console
    const baseFlags = "-skip_gameinfo -nogameinfo";
    const flags = showMame ? `${baseFlags} -window` : baseFlags;

    console.log(`[${emulator || "mame"}] Iniciando: "${mameExe}" ${rom} ${flags}  (showMame=${!!showMame})`);

    try {
      const mameExeQuoted = mameExe.includes(" ") ? `"${mameExe}"` : mameExe;
      const cmd = `${mameExeQuoted} ${rom} ${flags}`;

      let child;
      if (showMame) {
        // Modo visível: abre console + janela do MAME normalmente
        child = spawn("cmd.exe", ["/c", "start", "", "/D", mameDir, mameExe, rom, ...flags.split(" ")], {
          cwd: mameDir, detached: true, stdio: "ignore",
        });
      } else {
        // Modo oculto (padrão): VBScript esconde o console; só o jogo aparece em fullscreen
        const vbsContent = `Set oShell = CreateObject("WScript.Shell")\r\noShell.Run "${cmd.replace(/"/g, '""')}", 0, False\r\n`;
        const vbsPath = path.join(mameDir, "_mga_launch.vbs");
        fs.writeFileSync(vbsPath, vbsContent, "utf8");
        child = spawn("wscript.exe", [vbsPath], {
          cwd: mameDir, detached: true, stdio: "ignore", windowsHide: true,
        });
        setTimeout(() => { try { fs.unlinkSync(vbsPath); } catch {} }, 10000);
      }

      child.on("error", (err) => console.error(`[MAME] Erro ao lançar ${rom}:`, err.message));
      child.unref();

      appendLog({ rom, ok: true, pid: child.pid, showMame: !!showMame, emulator: emulator || "mame" });
      json(res, 200, { ok: true, rom, pid: child.pid, cmd, showMame: !!showMame, emulator: emulator || "mame", exePath: mameExe });
    } catch (err) {
      console.error(`[MAME] Falha:`, err);
      json(res, 500, { error: `Falha ao iniciar MAME: ${err.message}` });
    }
    return;
  }


  json(res, 404, { error: "Rota não encontrada" });
}

const server = http.createServer(handleRequest);
server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n✅ MAME Backend v3 rodando em http://localhost:${PORT}\n`);
});
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`❌ Porta ${PORT} já em uso. Feche o processo anterior.`);
  } else {
    console.error("Erro:", err);
  }
  process.exit(1);
});
