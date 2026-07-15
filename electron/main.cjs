// Master Games Arcade - Electron Main
// Spawns: (1) local backend (porta 7777), (2) Vite/static app server,
// then opens a BrowserWindow no app.

const { app, BrowserWindow, shell, Menu } = require("electron");
// Permite autoplay de video com som (a intro tem audio).
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const http = require("http");

const isDev = !app.isPackaged;

// Handler global — evita o popup "A JavaScript error occurred in the main process"
process.on("uncaughtException", (err) => {
  try { console.error("[MGA] uncaughtException:", err && err.stack || err); } catch { /* noop */ }
});
process.on("unhandledRejection", (err) => {
  try { console.error("[MGA] unhandledRejection:", err); } catch { /* noop */ }
});

const APP_ROOT = isDev ? path.join(__dirname, "..") : app.getAppPath();
const RESOURCE_ROOT = isDev ? path.join(APP_ROOT, "resources") : process.resourcesPath;
const APP_PORT = 8080;
const MAME_PORT = 7777;

// Caminho fixo do FinalBurn Neo embutido no instalador.
// Em produção: tenta <resources>/fbneo e <resources>/app/resources/...
// Em dev: <repo>/resources/...
function uniqueExistingRoots(roots) {
  const seen = new Set();
  return roots.filter((root) => {
    if (!root || seen.has(root)) return false;
    seen.add(root);
    try { return fs.existsSync(root); } catch { return false; }
  });
}

const APP_ROOTS = uniqueExistingRoots([
  APP_ROOT,
  path.join(RESOURCE_ROOT, "app"),
  RESOURCE_ROOT,
  path.dirname(process.execPath),
]);

function firstExistingPath(candidates) {
  for (const candidate of candidates) {
    try { if (fs.existsSync(candidate)) return candidate; } catch { /* noop */ }
  }
  return candidates[0];
}

function firstExistingFile(candidates) {
  for (const candidate of candidates) {
    try { if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate; } catch { /* noop */ }
  }
  return "";
}

function fromRoots(segments, roots = APP_ROOTS) {
  return roots.map((root) => path.join(root, ...segments));
}

const FBNEO_EXE = firstExistingPath([
  path.join(RESOURCE_ROOT, "fbneo", "fbneo64.exe"),
  path.join(APP_ROOT, "resources", "fbneo", "fbneo64.exe"),
  ...fromRoots(["resources", "fbneo", "fbneo64.exe"]),
]);
// Compat: aliases antigos apontam para FBNeo para nao quebrar chamadas antigas do backend.
const MAME_EXE = FBNEO_EXE;
const MAMEPLUS_EXE = FBNEO_EXE;

let mainWindow = null;
let mameServerProc = null;
let viteProc = null;
let staticServer = null;

function log(...args) {
  console.log("[MGA]", ...args);
}

function waitForPort(port, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const req = http.request({ host: "127.0.0.1", port, path: "/", method: "GET", timeout: 1500 }, (res) => {
        res.resume();
        resolve(true);
      });
      req.on("error", () => {
        if (Date.now() - start > timeoutMs) return reject(new Error(`Timeout waiting for port ${port}`));
        setTimeout(tick, 500);
      });
      req.on("timeout", () => { req.destroy(); });
      req.end();
    };
    tick();
  });
}

function spawnMameServer() {
  const serverPath = firstExistingFile([
    path.join(APP_ROOT, "mame-server.js"),
    path.join(RESOURCE_ROOT, "app", "mame-server.js"),
    path.join(RESOURCE_ROOT, "mame-server.js"),
    ...fromRoots(["mame-server.js"]),
  ]);
  if (!fs.existsSync(serverPath)) {
    log("mame-server.js não encontrado em", serverPath);
    return;
  }
  let runnableServerPath = serverPath;
  // Sempre copia para fora do asar como .mjs. Isso evita falhas no Windows
  // quando o backend está dentro de app.asar/extraResources e garante ESM.
  try {
    const tempDir = path.join(app.getPath("userData"), "runtime");
    fs.mkdirSync(tempDir, { recursive: true });
    runnableServerPath = path.join(tempDir, "mame-server.mjs");
    fs.copyFileSync(serverPath, runnableServerPath);
  } catch (err) {
    log("Falha ao preparar mame-server.mjs:", err.message);
  }
  log("Iniciando mame-server.js...");
  // Windows: process.execPath tem espacos ("Program Files"). Sem shell:true o spawn
  // devolve ENOENT. Envolvemos em try/catch para nunca derrubar o main.
  try {
    mameServerProc = spawn(`"${process.execPath}"`, [`"${runnableServerPath}"`], {
      cwd: path.dirname(runnableServerPath),
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        MGA_MAME_EXE: MAME_EXE,
        MGA_MAMEPLUS_EXE: MAMEPLUS_EXE,
        MGA_FBNEO_EXE: FBNEO_EXE,
        MGA_USER_DATA_DIR: app.getPath("userData"),
      },
      stdio: "inherit",
      shell: true,
      windowsHide: true,
    });
    mameServerProc.on("error", (err) => log("mame-server erro:", err.message));
    mameServerProc.on("exit", (code) => log("mame-server saiu com código", code));
  } catch (err) {
    log("Falha ao spawn mame-server:", err.message);
  }
}

function serveStaticFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".mp4": "video/mp4",
    ".woff2": "font/woff2",
  };
  res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
  fs.createReadStream(filePath)
    .on("error", () => {
      try { res.end(); } catch { /* noop */ }
    })
    .pipe(res);
}

function startStaticServer() {
  const distDirs = APP_ROOTS.flatMap((root) => [path.join(root, "dist", "client"), path.join(root, "dist")]);
  const publicDirs = APP_ROOTS.map((root) => path.join(root, "public"));
  const introFiles = [
    ...fromRoots(["intro.html"]),
    ...publicDirs.map((dir) => path.join(dir, "intro.html")),
  ];

  function getClientDistDir() {
    return distDirs.find((dir) => {
      try { return fs.existsSync(path.join(dir, "assets")); } catch { return false; }
    }) || distDirs[0];
  }

  function getAssetFiles(ext) {
    const assetsDir = path.join(getClientDistDir(), "assets");
    try {
      return fs.readdirSync(assetsDir)
        .filter((file) => file.toLowerCase().endsWith(ext))
        .sort();
    } catch { return []; }
  }

  function getEntryScript() {
    const assetsDir = path.join(getClientDistDir(), "assets");
    for (const file of getAssetFiles(".js")) {
      try {
        const content = fs.readFileSync(path.join(assetsDir, file), "utf8");
        if (content.includes("hydrateRoot(document")) return file;
      } catch { /* noop */ }
    }
    return getAssetFiles(".js")[0] || "";
  }

  function renderAppShell(res) {
    const entry = getEntryScript();
    if (!entry) return renderMissingApp(res);
    const cssLinks = getAssetFiles(".css")
      .map((file) => `<link rel="stylesheet" href="/assets/${file}">`)
      .join("");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Master Games Arcade</title>${cssLinks}</head><body><script type="module" src="/assets/${entry}"></script></body></html>`);
  }

  function safeFile(root, pathname) {
    const relative = pathname.replace(/^\/+/, "");
    const candidate = path.normalize(path.join(root, relative));
    const rootNormalized = path.normalize(root);
    if (!candidate.startsWith(rootNormalized)) return "";
    try { return fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : ""; } catch { return ""; }
  }

  function renderMissingApp(res) {
    res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Master Games Arcade</title><style>body{margin:0;background:#000;color:#00e5ff;font:18px monospace;display:grid;place-items:center;height:100vh}main{max-width:760px;padding:32px;text-align:center}b{color:#fff}</style></head><body><main><b>Master Games Arcade</b><br><br>Instalação incompleta: arquivos do launcher não foram encontrados.<br>Reinstale usando o instalador completo atualizado.</main></body></html>`);
  }

  staticServer = http.createServer((req, res) => {
    const url = new URL(req.url || "/", `http://127.0.0.1:${APP_PORT}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/") pathname = "/index.html";

    const candidates = [];
    if (pathname === "/intro.html") candidates.push(...introFiles);
    for (const dir of distDirs) candidates.push(safeFile(dir, pathname));
    for (const dir of publicDirs) candidates.push(safeFile(dir, pathname));
    for (const dir of distDirs) candidates.push(path.join(dir, "index.html"));

    const filePath = firstExistingFile(candidates.filter(Boolean));

    if (!filePath) {
      renderAppShell(res);
      return;
    }
    serveStaticFile(res, filePath);
  });
  staticServer.listen(APP_PORT, "127.0.0.1", () => log("Servidor do app pronto na porta", APP_PORT));
  staticServer.on("error", (err) => log("Servidor do app erro:", err.message));
}

function spawnVite() {
  if (!isDev) {
    startStaticServer();
    return;
  }
  const cmd = process.platform === "win32" ? "npx.cmd" : "npx";
  const args = ["vite", "dev", "--port", String(APP_PORT)];
  log("Iniciando Vite:", cmd, args.join(" "));
  viteProc = spawn(cmd, args, {
    cwd: APP_ROOT,
    env: { ...process.env },
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  viteProc.on("exit", (code) => log("vite saiu com código", code));
}

async function createWindow() {
  const iconPath = firstExistingFile([
    ...fromRoots(["public", "favicon.ico"]),
    path.join(RESOURCE_ROOT, "app.ico"),
  ]);
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    fullscreenable: true,
    icon: iconPath || path.join(APP_ROOT, "public", "favicon.ico"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  Menu.setApplicationMenu(null);

  // Abrir links externos no navegador padrão
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // Splash: carrega intro.html local imediatamente
  const introPath = firstExistingFile([
    ...fromRoots(["intro.html"]),
    ...fromRoots(["public", "intro.html"]),
  ]);
  if (fs.existsSync(introPath)) {
    await mainWindow.loadFile(introPath);
  } else {
    await mainWindow.loadURL(`http://127.0.0.1:${APP_PORT}/intro.html`);
  }

  // Os servicos (mame-server + Vite) iniciam em background,
  // mas NAO forcam transicao — o usuario clica "INSERIR FICHA" na intro.
  // So aguardamos silenciosamente para garantir que estejam prontos.
  try {
    await waitForPort(MAME_PORT, 60000);
    log("mame-server pronto na porta", MAME_PORT);
  } catch (err) {
    log("mame-server nao respondeu:", err.message);
  }
  try {
    await waitForPort(APP_PORT, 60000);
    log("Vite pronto na porta", APP_PORT);
  } catch (err) {
    log("Vite nao respondeu:", err.message);
  }
}

app.whenReady().then(async () => {
  spawnMameServer();
  spawnVite();
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  try { if (mameServerProc) mameServerProc.kill(); } catch { /* noop */ }
  try { if (viteProc) viteProc.kill(); } catch { /* noop */ }
  try { if (staticServer) staticServer.close(); } catch { /* noop */ }
});