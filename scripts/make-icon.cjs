#!/usr/bin/env node
/**
 * Gera build/icon.ico (multi-tamanho) a partir de public/assets/background.png
 * Tenta também gerar BMPs do instalador (header 150x57, sidebar 164x314) via sharp se disponível.
 */
const fs = require("fs");
const path = require("path");
const pngToIco = require("png-to-ico");
const { Jimp } = (() => {
  try { const j = require("jimp"); return j.Jimp ? j : { Jimp: j }; } catch { return { Jimp: null }; }
})();

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "public", "assets", "background.png");
const BUILD = path.join(ROOT, "build");
const ICO_OUT = path.join(BUILD, "icon.ico");
const PNG_OUT = path.join(BUILD, "icon.png");
const HEADER_BMP = path.join(BUILD, "installerHeader.bmp");
const SIDEBAR_BMP = path.join(BUILD, "installerSidebar.bmp");

(async () => {
  if (!fs.existsSync(SRC)) {
    console.error("[icon] Origem não encontrada:", SRC);
    process.exit(1);
  }
  if (!fs.existsSync(BUILD)) fs.mkdirSync(BUILD, { recursive: true });

  // Copia o PNG para build/ (electron-builder usa como fallback)
  fs.copyFileSync(SRC, PNG_OUT);

  // Redimensiona para 256x256 antes do .ico (png-to-ico exige <=256)
  const tmpPng = path.join(BUILD, "icon_256.png");
  if (Jimp) {
    const img = await Jimp.read(SRC);
    img.cover(256, 256);
    await img.writeAsync(tmpPng);

    // BMPs do instalador NSIS (header 150x57, sidebar 164x314)
    try {
      const header = await Jimp.read(SRC);
      header.cover(150, 57).quality(90);
      await header.writeAsync(HEADER_BMP);
      const sidebar = await Jimp.read(SRC);
      sidebar.cover(164, 314).quality(90);
      await sidebar.writeAsync(SIDEBAR_BMP);
      console.log("[icon] BMPs do instalador gerados");
    } catch (e) {
      console.warn("[icon] Falha ao gerar BMPs do instalador:", e.message);
    }
  } else {
    fs.copyFileSync(SRC, tmpPng);
  }

  try {
    const buf = await pngToIco([tmpPng]);
    fs.writeFileSync(ICO_OUT, buf);
    console.log("[icon] Gerado:", ICO_OUT, `(${buf.length} bytes)`);
  } catch (e) {
    console.error("[icon] Falha ao gerar .ico:", e.message);
    process.exit(1);
  }
})();