/**
 * MAME Local Backend Server - v3
 * Correção: spawn com shell:true para garantir execução no Windows
 */

import http from "http";
import { spawn, execFile } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import https from "https";

const PORT = 7777;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = path.join(__dirname, "config.json");
const LOG_FILE = path.join(__dirname, "launches.log");
const NAMES_FILE = path.join(__dirname, "names.json");

// Estado global do progresso de instalação do MAME (consumido por /api/install-mame/status)
const installProgress = {
  active: false,
  phase: "idle", // idle | fetching-release | downloading | extracting | done | error
  message: "",
  percent: 0,
  totalBytes: 0,
  downloadedBytes: 0,
  mamePath: "",
  romsDir: "",
  error: "",
};

function resetInstallProgress() {
  installProgress.active = false;
  installProgress.phase = "idle";
  installProgress.message = "";
  installProgress.percent = 0;
  installProgress.totalBytes = 0;
  installProgress.downloadedBytes = 0;
  installProgress.mamePath = "";
  installProgress.romsDir = "";
  installProgress.error = "";
}

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

// Baixa um arquivo via HTTPS seguindo redirects (até 5). onProgress(downloaded, total).
function downloadFile(url, destPath, redirects = 5, onProgress = null) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { "User-Agent": "MasterGamesArcade/1.0" } }, (resp) => {
      if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location && redirects > 0) {
        resp.resume();
        const next = new URL(resp.headers.location, url).toString();
        resolve(downloadFile(next, destPath, redirects - 1, onProgress));
        return;
      }
      if (resp.statusCode !== 200) { resp.resume(); resolve(false); return; }
      try { fs.mkdirSync(path.dirname(destPath), { recursive: true }); } catch {}
      const total = parseInt(resp.headers["content-length"] || "0", 10);
      let downloaded = 0;
      if (onProgress) {
        resp.on("data", (chunk) => { downloaded += chunk.length; onProgress(downloaded, total); });
      }
      const file = fs.createWriteStream(destPath);
      resp.pipe(file);
      file.on("finish", () => file.close(() => resolve(true)));
      file.on("error", () => { try { fs.unlinkSync(destPath); } catch {} resolve(false); });
    });
    req.on("error", () => resolve(false));
    req.setTimeout(120000, () => { req.destroy(); resolve(false); });
  });
}

// Busca o último release do MAME no GitHub e devolve a URL do .exe 64-bit
function fetchLatestMameAssetUrl() {
  return new Promise((resolve) => {
    https.get(
      "https://api.github.com/repos/mamedev/mame/releases/latest",
      { headers: { "User-Agent": "MasterGamesArcade/1.0", Accept: "application/vnd.github+json" } },
      (resp) => {
        let body = "";
        resp.on("data", (c) => (body += c));
        resp.on("end", () => {
          try {
            const data = JSON.parse(body);
            const assets = data.assets || [];
            const win = assets.find((a) => /mame.*64bit\.exe$/i.test(a.name))
                     || assets.find((a) => /mame.*windows.*\.exe$/i.test(a.name))
                     || assets.find((a) => /\.exe$/i.test(a.name));
            if (!win) { resolve(null); return; }
            resolve({ url: win.browser_download_url, name: win.name, size: win.size, tag: data.tag_name });
          } catch { resolve(null); }
        });
      },
    ).on("error", () => resolve(null));
  });
}

// Extrai self-extracting 7z do MAME (mameXXXX_64bit.exe -y -o"DEST")
function extractMameSfx(sfxExe, destDir) {
  return new Promise((resolve) => {
    try { fs.mkdirSync(destDir, { recursive: true }); } catch {}
    const child = spawn(sfxExe, ["-y", `-o${destDir}`], { cwd: destDir, windowsHide: true });
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}

async function runInstallMame(destDir) {
  try {
    installProgress.active = true;
    installProgress.phase = "fetching-release";
    installProgress.message = "Procurando última versão do MAME no GitHub...";
    installProgress.percent = 1;
    const asset = await fetchLatestMameAssetUrl();
    if (!asset) {
      installProgress.phase = "error";
      installProgress.error = "Não foi possível obter a release do MAME";
      installProgress.active = false;
      return;
    }
    fs.mkdirSync(destDir, { recursive: true });
    const sfxPath = path.join(destDir, asset.name);
    installProgress.phase = "downloading";
    installProgress.message = `Baixando ${asset.name} (${asset.tag})...`;
    installProgress.totalBytes = asset.size || 0;
    const ok = await downloadFile(asset.url, sfxPath, 5, (d, t) => {
      installProgress.downloadedBytes = d;
      installProgress.totalBytes = t || asset.size || 0;
      const tot = installProgress.totalBytes || 1;
      installProgress.percent = Math.min(85, Math.round((d / tot) * 80) + 2);
    });
    if (!ok) {
      installProgress.phase = "error";
      installProgress.error = "Falha ao baixar o instalador do MAME";
      installProgress.active = false;
      return;
    }
    installProgress.phase = "extracting";
    installProgress.message = "Extraindo arquivos do MAME (isso pode demorar 1-2min)...";
    installProgress.percent = 88;
    const extractDir = path.join(destDir, "MAME");
    const extracted = await extractMameSfx(sfxPath, extractDir);
    if (!extracted) {
      installProgress.phase = "error";
      installProgress.error = "Falha ao extrair o MAME (.exe SFX)";
      installProgress.active = false;
      return;
    }
    // Localiza mame.exe (na raiz ou subpasta)
    let mameExe = "";
    const tryPaths = [path.join(extractDir, "mame.exe"), path.join(extractDir, "mame64.exe")];
    for (const p of tryPaths) if (fs.existsSync(p)) { mameExe = p; break; }
    if (!mameExe) {
      // procura recursivamente até 2 níveis
      const walk = (dir, depth) => {
        if (depth < 0) return null;
        try {
          for (const f of fs.readdirSync(dir)) {
            const full = path.join(dir, f);
            const st = fs.statSync(full);
            if (st.isFile() && /^mame(64)?\.exe$/i.test(f)) return full;
            if (st.isDirectory()) {
              const r = walk(full, depth - 1);
              if (r) return r;
            }
          }
        } catch {}
        return null;
      };
      mameExe = walk(extractDir, 2) || "";
    }
    if (!mameExe) {
      installProgress.phase = "error";
      installProgress.error = "mame.exe não foi encontrado após extração";
      installProgress.active = false;
      return;
    }
    const mameDir = path.dirname(mameExe);
    const romsDir = path.join(mameDir, "roms");
    try { fs.mkdirSync(romsDir, { recursive: true }); } catch {}
    // Persiste configuração
    writeConfig({ ...readConfig(), mamePath: mameExe, romsDir, updatedAt: Date.now() });
    // Escreve rompath no mame.ini
    try {
      const iniPath = path.join(mameDir, "mame.ini");
      if (!fs.existsSync(iniPath)) {
        await new Promise((resolve) => execFile(mameExe, ["-createconfig"], { cwd: mameDir }, () => resolve()));
      }
      writeMameIniKey(mameDir, "rompath", romsDir);
    } catch {}
    // Limpa o SFX baixado para economizar espaço
    try { fs.unlinkSync(sfxPath); } catch {}
    installProgress.mamePath = mameExe;
    installProgress.romsDir = romsDir;
    installProgress.percent = 100;
    installProgress.phase = "done";
    installProgress.message = `✓ MAME instalado em ${mameDir}`;
    installProgress.active = false;
  } catch (e) {
    installProgress.phase = "error";
    installProgress.error = String(e && e.message || e);
    installProgress.active = false;
  }
}

// Fontes públicas para artes do MAME (snap/title/marquee)
function artSources(rom, kind) {
  const r = encodeURIComponent(rom);
  if (kind === "snap") return [
    `https://thumbnails.libretro.com/MAME/Named_Snaps/${r}.png`,
    `https://archive.org/download/mame-merged/snap/${r}.png`,
  ];
  if (kind === "title") return [
    `https://thumbnails.libretro.com/MAME/Named_Titles/${r}.png`,
    `https://archive.org/download/mame-titles/${r}.png`,
  ];
  if (kind === "boxart") return [
    `https://thumbnails.libretro.com/MAME/Named_Boxarts/${r}.png`,
  ];
  if (kind === "icon") return [
    `https://thumbnails.libretro.com/MAME/Named_Boxarts/${r}.png`,
  ];
  return [];
}

// Procura uma arte nas pastas locais do MAME (snap/snaps/titles/icons) e
// no diretório "images" gerado pelo download em massa.
function findLocalArt(mameDir, romsDir, rom, kind) {
  const candidates = [];
  const kindFolders = {
    snap:  ["snap", "snaps", "snapshots"],
    title: ["titles", "title"],
    icon:  ["icons", "ico"],
    boxart:["boxart", "boxarts", "cabinets"],
  }[kind] || [];
  const exts = kind === "icon" ? [".png", ".ico"] : [".png", ".jpg", ".jpeg"];
  const roots = [];
  if (mameDir) roots.push(mameDir);
  if (romsDir) roots.push(path.dirname(path.resolve(romsDir)));
  for (const root of roots) {
    for (const f of kindFolders) {
      for (const e of exts) candidates.push(path.join(root, f, `${rom}${e}`));
      for (const e of exts) candidates.push(path.join(root, "images", f, `${rom}${e}`));
    }
    // Algumas distros guardam dentro de .zip — não suportado aqui.
  }
  // Pasta padrão "<romsDir>/../images/<kind>/" usada por /api/download-images
  if (romsDir) {
    const base = path.join(path.dirname(path.resolve(romsDir)), "images", kind);
    for (const e of exts) candidates.push(path.join(base, `${rom}${e}`));
  }
  for (const c of candidates) {
    try { if (fs.existsSync(c) && fs.statSync(c).size > 200) return c; } catch {}
  }
  return null;
}

function mimeFor(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".ico") return "image/x-icon";
  return "application/octet-stream";
}

// Roda `mame -listfull` e devolve { rom: "Full Title" }
function loadNamesCache() {
  try { return JSON.parse(fs.readFileSync(NAMES_FILE, "utf8")); } catch { return {}; }
}
function saveNamesCache(data) {
  try { fs.writeFileSync(NAMES_FILE, JSON.stringify(data), "utf8"); } catch {}
}
function runListfull(mameExe) {
  return new Promise((resolve) => {
    const cwd = path.dirname(mameExe);
    execFile(mameExe, ["-listfull"], { cwd, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
      if (err || !stdout) { resolve({}); return; }
      const names = {};
      // Formato: "<rom>            "Full Title"
      const re = /^(\S+)\s+"([^"]+)"/;
      for (const line of stdout.split(/\r?\n/)) {
        const m = re.exec(line);
        if (m) names[m[1]] = m[2];
      }
      resolve(names);
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
    json(res, 200, { ok: true, port: PORT, version: "v3.2" });
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

  // GET /api/check-mame?path=...
  if (req.method === "GET" && url.pathname === "/api/check-mame") {
    const mamePath = url.searchParams.get("path") || "";
    if (!mamePath) { json(res, 400, { error: "Parâmetro 'path' obrigatório" }); return; }
    const normalizedPath = path.resolve(mamePath.trim());
    const exists = fs.existsSync(normalizedPath);
    let currentRompath = "";
    if (exists) {
      const ini = readMameIni(path.dirname(normalizedPath));
      currentRompath = ini["rompath"] || "";
    }
    json(res, 200, { exists, path: normalizedPath, currentRompath });
    return;
  }

  // POST /api/download-images { romsPath, roms?: string[], kinds?: ('snap'|'title'|'boxart')[] }
  // Baixa as artes para <romsPath>/../images/<kind>/<rom>.png
  if (req.method === "POST" && url.pathname === "/api/download-images") {
    let body;
    try { body = await parseBody(req); } catch { json(res, 400, { error: "JSON inválido" }); return; }
    const romsPath = (body.romsPath || "").trim();
    if (!romsPath) { json(res, 400, { error: "romsPath obrigatório" }); return; }
    const romsDir = path.resolve(romsPath);
    if (!fs.existsSync(romsDir)) { json(res, 404, { error: `Pasta não encontrada: ${romsDir}` }); return; }
    let roms = Array.isArray(body.roms) && body.roms.length
      ? body.roms
      : fs.readdirSync(romsDir).filter((f) => /\.(zip|7z|chd)$/i.test(f));
    roms = roms.map((r) => r.replace(/\.(zip|7z|chd)$/i, ""));
    const kinds = Array.isArray(body.kinds) && body.kinds.length ? body.kinds : ["snap", "title"];
    const baseDir = path.join(path.dirname(romsDir), "images");
    console.log(`[IMG] Baixando artes para ${roms.length} ROMs em ${baseDir}`);
    let ok = 0, skipped = 0, failed = 0;
    const concurrency = 6;
    let idx = 0;
    async function worker() {
      while (idx < roms.length) {
        const rom = roms[idx++];
        for (const kind of kinds) {
          const dest = path.join(baseDir, kind, `${rom}.png`);
          if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) { skipped++; continue; }
          let success = false;
          for (const url of artSources(rom, kind)) {
            success = await downloadFile(url, dest);
            if (success) break;
          }
          if (success) ok++; else failed++;
        }
      }
    }
    await Promise.all(Array.from({ length: concurrency }, worker));
    console.log(`[IMG] Concluído: ${ok} baixadas, ${skipped} já existiam, ${failed} falharam`);
    json(res, 200, { ok: true, downloaded: ok, skipped, failed, dir: baseDir, total: roms.length * kinds.length });
    return;
  }

  // GET /api/image?rom=...&kind=snap  → serve a imagem local se existir
  if (req.method === "GET" && url.pathname === "/api/image") {
    const rom = (url.searchParams.get("rom") || "").replace(/\.(zip|7z|chd)$/i, "");
    const kind = url.searchParams.get("kind") || "snap";
    const auto = url.searchParams.get("auto") === "1";
    const cfg = readConfig();
    const romsDir = (cfg.romsDir || "").trim();
    const mameDir = cfg.mamePath ? path.dirname(path.resolve(cfg.mamePath)) : "";
    if (!rom) { res.writeHead(404); res.end(); return; }
    let file = findLocalArt(mameDir, romsDir, rom, kind);
    // Se não achou e auto=1, tenta baixar agora para a pasta padrão
    if (!file && auto && romsDir) {
      const dest = path.join(path.dirname(path.resolve(romsDir)), "images", kind, `${rom}.png`);
      for (const src of artSources(rom, kind)) {
        const ok = await downloadFile(src, dest);
        if (ok) { file = dest; break; }
      }
    }
    if (!file) { res.writeHead(404, { "Access-Control-Allow-Origin": "*" }); res.end(); return; }
    res.writeHead(200, { "Content-Type": mimeFor(file), "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=86400" });
    fs.createReadStream(file).pipe(res);
    return;
  }

  // GET /api/names?mamePath=... → { names: { rom: "Full Title", ... } }
  // Roda mame -listfull (cacheia em names.json). Se ?refresh=1, força rerun.
  if (req.method === "GET" && url.pathname === "/api/names") {
    const mamePath = (url.searchParams.get("mamePath") || readConfig().mamePath || "").trim();
    const refresh = url.searchParams.get("refresh") === "1";
    let cache = loadNamesCache();
    if (!refresh && Object.keys(cache).length > 100) { json(res, 200, { names: cache, cached: true, total: Object.keys(cache).length }); return; }
    if (!mamePath) { json(res, 200, { names: cache, cached: true, total: Object.keys(cache).length }); return; }
    const exe = path.resolve(mamePath);
    if (!fs.existsSync(exe)) { json(res, 404, { error: `MAME não encontrado: ${exe}`, names: cache }); return; }
    console.log(`[NAMES] Executando ${exe} -listfull (pode demorar uns segundos)...`);
    const names = await runListfull(exe);
    const total = Object.keys(names).length;
    if (total > 0) { saveNamesCache(names); cache = names; }
    console.log(`[NAMES] ${total} nomes carregados`);
    json(res, 200, { names: cache, cached: total === 0, total: Object.keys(cache).length });
    return;
  }

  // POST /api/set-rompath
  if (req.method === "POST" && url.pathname === "/api/set-rompath") {
    let body;
    try { body = await parseBody(req); } catch { json(res, 400, { error: "JSON inválido" }); return; }
    const { mamePath, romsPath } = body;
    if (!mamePath || !romsPath) { json(res, 400, { error: "mamePath e romsPath obrigatórios" }); return; }
    const mameExe = path.resolve(mamePath.trim());
    if (!fs.existsSync(mameExe)) { json(res, 404, { error: `MAME não encontrado: ${mameExe}` }); return; }
    const mameDir = path.dirname(mameExe);
    const romsDir = path.resolve(romsPath.trim());
    // Persiste config global (sobrevive a reinício)
    writeConfig({ ...readConfig(), mamePath: mameExe, romsDir, updatedAt: Date.now() });
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

  // POST /api/reset-controls  { mamePath }
  // Escreve cfg/default.cfg com mapeamento de TECLADO padrão para todas as ROMs.
  if (req.method === "POST" && url.pathname === "/api/reset-controls") {
    let body;
    try { body = await parseBody(req); } catch { json(res, 400, { error: "JSON inválido" }); return; }
    const { mamePath } = body;
    if (!mamePath) { json(res, 400, { error: "mamePath obrigatório" }); return; }
    const mameExe = path.resolve(mamePath.trim());
    if (!fs.existsSync(mameExe)) { json(res, 404, { error: `MAME não encontrado: ${mameExe}` }); return; }
    const mameDir = path.dirname(mameExe);
    const cfgDir = path.join(mameDir, "cfg");
    try {
      if (!fs.existsSync(cfgDir)) fs.mkdirSync(cfgDir, { recursive: true });
      // Mapeamento de teclado completo (P1 + P2 + sistema). Aplica-se a TODAS as ROMs.
      const map = [
        // Sistema
        ["UI_CANCEL",       "KEYCODE_ESC"],
        ["START1",          "KEYCODE_1"],
        ["START2",          "KEYCODE_2"],
        ["COIN1",           "KEYCODE_5"],
        ["COIN2",           "KEYCODE_6"],
        // P1
        ["P1_JOYSTICK_UP",    "KEYCODE_UP"],
        ["P1_JOYSTICK_DOWN",  "KEYCODE_DOWN"],
        ["P1_JOYSTICK_LEFT",  "KEYCODE_LEFT"],
        ["P1_JOYSTICK_RIGHT", "KEYCODE_RIGHT"],
        ["P1_BUTTON1",      "KEYCODE_LCONTROL"],
        ["P1_BUTTON2",      "KEYCODE_LALT"],
        ["P1_BUTTON3",      "KEYCODE_SPACE"],
        ["P1_BUTTON4",      "KEYCODE_LSHIFT"],
        ["P1_BUTTON5",      "KEYCODE_Z"],
        ["P1_BUTTON6",      "KEYCODE_X"],
        // P2
        ["P2_JOYSTICK_UP",    "KEYCODE_R"],
        ["P2_JOYSTICK_DOWN",  "KEYCODE_F"],
        ["P2_JOYSTICK_LEFT",  "KEYCODE_D"],
        ["P2_JOYSTICK_RIGHT", "KEYCODE_G"],
        ["P2_BUTTON1",      "KEYCODE_A"],
        ["P2_BUTTON2",      "KEYCODE_S"],
        ["P2_BUTTON3",      "KEYCODE_Q"],
        ["P2_BUTTON4",      "KEYCODE_W"],
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

  // POST /api/launch  { mamePath, romName, showMame? }
  // POST /api/install-mame { destDir } — inicia download/extração do MAME oficial
  if (req.method === "POST" && url.pathname === "/api/install-mame") {
    if (installProgress.active) { json(res, 409, { error: "Instalação já em andamento", progress: installProgress }); return; }
    let body;
    try { body = await parseBody(req); } catch { json(res, 400, { error: "JSON inválido" }); return; }
    const destDir = (body.destDir || "").trim();
    if (!destDir) { json(res, 400, { error: "destDir obrigatório" }); return; }
    resetInstallProgress();
    runInstallMame(path.resolve(destDir)); // fire and forget
    json(res, 202, { ok: true, message: "Instalação iniciada. Poll em /api/install-mame/status" });
    return;
  }

  // GET /api/install-mame/status — devolve o progresso atual
  if (req.method === "GET" && url.pathname === "/api/install-mame/status") {
    json(res, 200, installProgress);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/launch") {
    let body;
    try { body = await parseBody(req); } catch { json(res, 400, { error: "JSON inválido" }); return; }
    const { mamePath, romName, showMame } = body;
    if (!mamePath || !romName) { json(res, 400, { error: "mamePath e romName obrigatórios" }); return; }

    const mameExe = path.resolve(mamePath.trim());
    if (!fs.existsSync(mameExe)) {
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

    console.log(`[MAME] Iniciando: "${mameExe}" ${rom} ${flags}  (showMame=${!!showMame})`);

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

      appendLog({ rom, ok: true, pid: child.pid, showMame: !!showMame });
      json(res, 200, { ok: true, rom, pid: child.pid, cmd, showMame: !!showMame });
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
