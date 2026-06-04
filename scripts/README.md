# Scripts · Master Games Arcade · DEV EMERSON 2026

## Upscale automatico de assets

Melhora resolucao e cores das imagens em `src/assets/` e `public/assets/`
usando Pillow (LANCZOS 2x + autocontrast + boost de cor/contraste/nitidez).

### Como rodar

```bash
# Linux / macOS
bash scripts/upscale.sh

# Windows
python scripts/upscale_assets.py
```

Gera para cada imagem um `nome_hd.png` na mesma pasta (nao destrutivo,
idempotente). Resultados ficam em `scripts/assets-manifest.json`.

### Opcoes

- `--scale 3` — upscale 3x em vez de 2x.
- `--force`  — reprocessa mesmo se o `_hd.png` ja existir.

### Como o app usa

O componente `<LazyLoadImage>` tenta primeiro o `_hd.png` e cai na
original se ele nao existir — sem mudar nada no codigo.

### Parametros de enhancement

Inspirados em boas praticas de foruns retro-arcade (RetroArch CRT-Royale,
Libretro, BYUU) para realcar pixel art sem destruir o look original:

- Color   +15%
- Contrast +10%
- Sharpness +25%
- Autocontrast com cutoff 0.5 e preserve_tone