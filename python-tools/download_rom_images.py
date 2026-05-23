"""
Master Games Arcade · dev emerson 2026
Baixa snaps + titles + marquees de TODAS as ROMs detectadas (de uma vez).
Fontes: Progetto Snaps (progettosnaps.net) — domínio público para uso pessoal.

Uso:
  python download_rom_images.py <pasta_roms> <pasta_destino>
"""
import sys, os, urllib.request, zipfile, io
from pathlib import Path

SOURCES = {
    "snap":    "https://www.progettosnaps.net/snaps/packs/pS_snap_{rom}.zip",
    "title":   "https://www.progettosnaps.net/titles/packs/pS_title_{rom}.zip",
    "marquee": "https://www.progettosnaps.net/marquees/packs/pS_marquee_{rom}.zip",
}

def list_roms(roms_dir: Path):
    return sorted({p.stem for p in roms_dir.glob("*") if p.suffix.lower() in {".zip", ".7z", ".chd"}})

def fetch(url: str, dst: Path):
    req = urllib.request.Request(url, headers={"User-Agent": "MasterGamesArcade/1.0 (dev emerson 2026)"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            data = r.read()
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_bytes(data)
        return True
    except Exception as e:
        print(f"  [skip] {url.split('/')[-1]}: {e}")
        return False

def main():
    if len(sys.argv) < 3:
        print("Uso: python download_rom_images.py <pasta_roms> <pasta_destino>")
        sys.exit(1)
    roms_dir, dst_dir = Path(sys.argv[1]), Path(sys.argv[2])
    roms = list_roms(roms_dir)
    print(f"🎮 {len(roms)} ROMs detectadas · baixando snaps/titles/marquees...")
    print("⚠  Pode demorar. dev emerson 2026\n")
    for i, rom in enumerate(roms, 1):
        print(f"[{i}/{len(roms)}] {rom}")
        for kind, tpl in SOURCES.items():
            out = dst_dir / kind / f"{rom}.png"
            if out.exists(): continue
            fetch(tpl.format(rom=rom), out)
    print("\n✅ Concluído · dev emerson 2026")

if __name__ == "__main__":
    main()
