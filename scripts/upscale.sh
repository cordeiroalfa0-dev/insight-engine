#!/usr/bin/env bash
# Master Games Arcade · DEV EMERSON 2026
# Instala Pillow (se necessario) e roda o upscale dos assets.
set -euo pipefail

cd "$(dirname "$0")/.."

PY=${PYTHON:-python3}
if ! command -v "$PY" >/dev/null; then
  echo "[!] Python 3 nao encontrado. Instale Python 3.10+ e tente de novo."
  exit 1
fi

if ! "$PY" -c "import PIL" 2>/dev/null; then
  echo "[*] Instalando Pillow..."
  "$PY" -m pip install --no-cache-dir pillow
fi

"$PY" scripts/upscale_assets.py "$@"