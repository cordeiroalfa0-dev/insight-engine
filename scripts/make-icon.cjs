#!/usr/bin/env node
/**
 * Gera build/icon.ico (multi-tamanho) a partir de public/assets/background.png
 * Tenta também gerar BMPs do instalador (header 150x57, sidebar 164x314) via sharp se disponível.
 */
const fs = require("fs");
const path = require("path");
const pngToIco = require("png-to-ico");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "public", "assets", "background.png");
const BUILD = path.join(ROOT, "build");
const ICO_OUT = path.join(BUILD, "icon.ico");
const PNG_OUT = path.join(BUILD, "icon.png");

(async () => {
  if (!fs.existsSync(SRC)) {
    console.error("[icon] Origem não encontrada:", SRC);
    process.exit(1);
  }
  if (!fs.existsSync(BUILD)) fs.mkdirSync(BUILD, { recursive: true });

  // Copia o PNG para build/ (electron-builder usa como fallback)
  fs.copyFileSync(SRC, PNG_OUT);

  try {
    const buf = await pngToIco([SRC]);
    fs.writeFileSync(ICO_OUT, buf);
    console.log("[icon] Gerado:", ICO_OUT, `(${buf.length} bytes)`);
  } catch (e) {
    console.error("[icon] Falha ao gerar .ico:", e.message);
    process.exit(1);
  }
})();