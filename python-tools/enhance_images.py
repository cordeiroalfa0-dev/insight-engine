"""
Master Games Arcade · dev emerson 2026
Melhora nitidez, cor e contraste de snaps/marquees/titles do MAME.
Uso:  python enhance_images.py <pasta_entrada> <pasta_saida>
"""
import sys, os
from pathlib import Path
try:
    from PIL import Image, ImageEnhance, ImageFilter
except ImportError:
    print("Instale Pillow:  pip install pillow")
    sys.exit(1)

def enhance(src: Path, dst: Path):
    img = Image.open(src).convert("RGB")
    w, h = img.size
    if max(w, h) < 600:
        img = img.resize((w * 2, h * 2), Image.LANCZOS)
    img = img.filter(ImageFilter.UnsharpMask(radius=1.5, percent=160, threshold=2))
    img = ImageEnhance.Color(img).enhance(1.25)
    img = ImageEnhance.Contrast(img).enhance(1.15)
    img = ImageEnhance.Sharpness(img).enhance(1.3)
    dst.parent.mkdir(parents=True, exist_ok=True)
    img.save(dst, "PNG", optimize=True)

def main():
    if len(sys.argv) < 3:
        print("Uso: python enhance_images.py <entrada> <saida>")
        sys.exit(1)
    src_dir, dst_dir = Path(sys.argv[1]), Path(sys.argv[2])
    n = 0
    for p in src_dir.rglob("*"):
        if p.suffix.lower() in {".png", ".jpg", ".jpeg", ".bmp", ".gif"}:
            rel = p.relative_to(src_dir).with_suffix(".png")
            try:
                enhance(p, dst_dir / rel)
                n += 1
                print(f"[OK] {rel}")
            except Exception as e:
                print(f"[ERRO] {rel}: {e}")
    print(f"\n✅ {n} imagens processadas · dev emerson 2026")

if __name__ == "__main__":
    main()
