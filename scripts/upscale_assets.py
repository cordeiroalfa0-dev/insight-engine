#!/usr/bin/env python3
"""
Master Games Arcade · DEV EMERSON 2026
Upscale + enhancement automatico das imagens do projeto.

Varre src/assets/ e public/assets/, gera uma copia _hd.png 2x maior com
filtro LANCZOS, satura/contrasta/aguca e roda autocontrast — valores
inspirados nas praticas dos foruns retro-arcade (RetroArch CRT-Royale,
Libretro, BYUU). Idempotente: pula imagens cujo _hd.png ja esta atualizado.

Uso:
    python scripts/upscale_assets.py             # processa tudo
    python scripts/upscale_assets.py --scale 3   # upscale 3x
    python scripts/upscale_assets.py --force     # reprocessa
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

try:
    from PIL import Image, ImageEnhance, ImageOps
except ImportError:
    sys.stderr.write("[!] Pillow nao encontrado. Instale com: python -m pip install pillow\n")
    sys.exit(1)

ROOT = Path(__file__).resolve().parent.parent
TARGETS = [ROOT / "src" / "assets", ROOT / "public" / "assets"]
EXTS = {".png", ".jpg", ".jpeg", ".webp"}

# Valores recomendados em foruns de retro-arcade para realcar pixel art
# sem destruir o look original.
COLOR_BOOST = 1.15      # +15% saturacao
CONTRAST_BOOST = 1.10   # +10% contraste
SHARPNESS_BOOST = 1.25  # +25% nitidez


def is_skipme(path: Path) -> bool:
    return path.stem.endswith("_hd")


def out_path(src: Path) -> Path:
    return src.with_name(f"{src.stem}_hd.png")


def needs_rebuild(src: Path, dst: Path, force: bool) -> bool:
    if force or not dst.exists():
        return True
    return dst.stat().st_mtime < src.stat().st_mtime


def enhance(img: Image.Image, scale: int) -> Image.Image:
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA")
    # Upscale com LANCZOS — melhor para pixel art / sprites.
    new_size = (img.width * scale, img.height * scale)
    img = img.resize(new_size, Image.Resampling.LANCZOS)
    # Autocontrast no canal de luminosidade reduz banding sem clipping.
    if img.mode == "RGBA":
        r, g, b, a = img.split()
        rgb = Image.merge("RGB", (r, g, b))
        rgb = ImageOps.autocontrast(rgb, cutoff=0.5, preserve_tone=True)
        r, g, b = rgb.split()
        img = Image.merge("RGBA", (r, g, b, a))
    else:
        img = ImageOps.autocontrast(img, cutoff=0.5, preserve_tone=True)
    img = ImageEnhance.Color(img).enhance(COLOR_BOOST)
    img = ImageEnhance.Contrast(img).enhance(CONTRAST_BOOST)
    img = ImageEnhance.Sharpness(img).enhance(SHARPNESS_BOOST)
    return img


def main() -> int:
    parser = argparse.ArgumentParser(description="Upscale + enhance assets — DEV EMERSON 2026")
    parser.add_argument("--scale", type=int, default=2, help="Fator de upscale (default 2)")
    parser.add_argument("--force", action="store_true", help="Reprocessa mesmo se _hd existir")
    args = parser.parse_args()

    manifest: list[dict] = []
    total, processed, skipped = 0, 0, 0

    for folder in TARGETS:
        if not folder.exists():
            print(f"[skip] pasta inexistente: {folder}")
            continue
        for src in sorted(folder.rglob("*")):
            if not src.is_file() or src.suffix.lower() not in EXTS:
                continue
            if is_skipme(src):
                continue
            total += 1
            dst = out_path(src)
            if not needs_rebuild(src, dst, args.force):
                skipped += 1
                print(f"[ok ] {src.relative_to(ROOT)}  (ja gerado)")
                continue
            try:
                with Image.open(src) as im:
                    orig_size = im.size
                    out = enhance(im, args.scale)
                    out.save(dst, format="PNG", optimize=True)
                processed += 1
                manifest.append({
                    "src": str(src.relative_to(ROOT)),
                    "dst": str(dst.relative_to(ROOT)),
                    "original": list(orig_size),
                    "upscaled": list(out.size),
                    "scale": args.scale,
                })
                print(f"[hd ] {src.relative_to(ROOT)} -> {dst.name}  {orig_size} -> {out.size}")
            except Exception as exc:
                print(f"[err] {src.relative_to(ROOT)}: {exc}")

    manifest_path = ROOT / "scripts" / "assets-manifest.json"
    manifest_path.write_text(json.dumps({
        "by": "DEV EMERSON 2026",
        "scale": args.scale,
        "color_boost": COLOR_BOOST,
        "contrast_boost": CONTRAST_BOOST,
        "sharpness_boost": SHARPNESS_BOOST,
        "items": manifest,
    }, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"\nMaster Games Arcade · DEV EMERSON 2026")
    print(f"Total: {total} | Processado: {processed} | Pulado: {skipped}")
    print(f"Manifesto: {manifest_path.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())