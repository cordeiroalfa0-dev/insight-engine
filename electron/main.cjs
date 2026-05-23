const { app, BrowserWindow, shell } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

let mainWindow;
let mameBackend;

const isDev = !app.isPackaged;
const appRoot = isDev ? __dirname + "/.." : process.resourcesPath;
const backendScript = path.join(appRoot, "mame-server.js");
const splashImage = path.join(__dirname, "..", "dist", "assets", "splash.png");

function startBackend() {
  if (!fs.existsSync(backendScript)) return;
  try {
    mameBackend = spawn(process.execPath, [backendScript], {
      cwd: path.dirname(backendScript),
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: "ignore",
      detached: false,
    });
    mameBackend.on("error", (e) => console.error("[backend]", e));
  } catch (e) {
    console.error("Falha ao iniciar backend:", e);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: "#0a0014",
    title: "Master Games Arcade · dev emerson 2026",
    icon: path.join(__dirname, "..", "dist", "favicon.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(() => {
  startBackend();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (mameBackend) try { mameBackend.kill(); } catch {}
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (mameBackend) try { mameBackend.kill(); } catch {}
});
