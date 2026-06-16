// Master Games Arcade - Electron Main
// Spawns: (1) mame-server.js (porta 7777), (2) Vite serving the React app,
// then opens a BrowserWindow no app.

const { app, BrowserWindow, shell, Menu } = require("electron");
// Permite autoplay de video com som (a intro tem audio).
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const http = require("http");

const isDev = !app.isPackaged;
const ROOT = isDev ? path.join(__dirname, "..") : process.resourcesPath;
const APP_PORT = 8080;
const MAME_PORT = 7777;

// Caminhos fixos dos emuladores embutidos no instalador.
// Em produção: <resources>/mame|mameplus. Em dev: <repo>/resources/...
const RES_BASE = app.isPackaged ? process.resourcesPath : path.join(__dirname, "..", "resources");
const MAME_EXE     = path.join(RES_BASE, "mame", "mame.exe");
const MAMEPLUS_EXE = path.join(RES_BASE, "mameplus", "mamep64.exe");

let mainWindow = null;
let mameServerProc = null;
let viteProc = null;

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
  const serverPath = path.join(ROOT, "mame-server.js");
  if (!fs.existsSync(serverPath)) {
    log("mame-server.js não encontrado em", serverPath);
    return;
  }
  log("Iniciando mame-server.js...");
  // Usa o node embutido no Electron (process.execPath) com ELECTRON_RUN_AS_NODE=1.
  // Injeta MGA_MAME_EXE / MGA_MAMEPLUS_EXE para o backend resolver os binarios
  // sem precisar consultar o usuario.
  mameServerProc = spawn(process.execPath, [serverPath], {
    cwd: ROOT,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      MGA_MAME_EXE: MAME_EXE,
      MGA_MAMEPLUS_EXE: MAMEPLUS_EXE,
    },
    stdio: "inherit",
  });
  mameServerProc.on("exit", (code) => log("mame-server saiu com código", code));
}

function spawnVite() {
  // Em produção, servimos os arquivos buildados via Vite preview.
  // Em dev, rodamos vite dev.
  const cmd = process.platform === "win32" ? "npx.cmd" : "npx";
  const args = isDev ? ["vite", "dev", "--port", String(APP_PORT)] : ["vite", "preview", "--port", String(APP_PORT)];
  log("Iniciando Vite:", cmd, args.join(" "));
  viteProc = spawn(cmd, args, {
    cwd: ROOT,
    env: { ...process.env },
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  viteProc.on("exit", (code) => log("vite saiu com código", code));
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    fullscreenable: true,
    icon: path.join(ROOT, "public", "favicon.ico"),
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
  const introPath = path.join(ROOT, "intro.html");
  if (fs.existsSync(introPath)) {
    await mainWindow.loadFile(introPath);
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
});