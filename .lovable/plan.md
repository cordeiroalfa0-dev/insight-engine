# Atualização: Teclado completo + Upscale Python + Branding DEV EMERSON 2026

## 1. Correção silenciosa do erro de runtime

O `index.tsx` importa `LazyLoadImage` como named export, mas o pacote é CommonJS e isso quebra a página no SSR. Trocar por import default:

```ts
import LazyLoad from "react-lazy-load-image-component";
const { LazyLoadImage } = LazyLoad;
```

## 2. Teclado completo (Soco / Chute / Tiro) para QUALQUER ROM

Hoje o backend grava `cfg/default.cfg` com 6 botões P1 + 4 P2. Vou expandir para um mapeamento universal pensado para os 3 gêneros mais comuns — luta (Street Fighter/KOF/MK), beat'em up (Cadillacs, Final Fight) e shoot'em up (1942, Metal Slug). Como `default.cfg` é herdado por todas as ROMs e o app já apaga `*.cfg` por-rom, o mesmo mapeamento vale para QUALQUER jogo.

Mapeamento P1 (teclado):

```text
Direção: Setas
SOCO FRACO  (Button1) = A     (também vira "Tiro" em shmups)
SOCO MÉDIO  (Button2) = S     (também vira "Bomba")
SOCO FORTE  (Button3) = D     (também vira "Pulo/Especial")
CHUTE FRACO (Button4) = Z
CHUTE MÉDIO (Button5) = X
CHUTE FORTE (Button6) = C
Start = 1   Coin = 5    ESC = sair
```

Mapeamento P2:

```text
Direção: R / F / D / G   (cima/baixo/esq/dir)
Botões: Y U I H J K (1-6)
Start = 2   Coin = 6
```

No MAME `BUTTONn` é genérico — a mesma tecla `A` é "soco fraco" no SF e "tiro" no 1942, igual a um arcade real. A UI vai mostrar a legenda completa com tooltip explicando os dois nomes.

## 3. Automação Python para melhorar resolução/cores das imagens

Criar pasta `scripts/` com `upscale_assets.py` que:

1. Varre `src/assets/` e `public/assets/` (.png/.jpg/.webp).
2. Para cada imagem:
   - Upscale 2x com **Pillow + LANCZOS** (alta qualidade, sem modelo IA pesado).
   - **ImageEnhance.Color** +15%, **Contrast** +10%, **Sharpness** +25% — valores baseados em práticas de fóruns retro-arcade (RetroArch CRT-Royale, Libretro, BYUU).
   - `ImageOps.autocontrast` para reduzir banding.
   - Salva como `_hd.png` ao lado do original (não destrutivo, idempotente).
3. Gera `assets-manifest.json` com tamanhos antes/depois.

Runner `scripts/upscale.sh` cuida de `pip install pillow` e da execução.

Integração no app: helper `hdSrc()` tenta `_hd.png` primeiro e cai na original como fallback no `LazyLoadImage`.

## 4. Branding "DEV EMERSON 2026"

Adicionar a assinatura em:

- Navbar à direita do logo: `// DEV EMERSON · 2026`
- Rodapé da sidebar de jogos
- Attract Mode (tela inativa): faixa inferior piscando `DEV EMERSON 2026`
- Painel de Config: cabeçalho `MASTER GAMES ARCADE · DEV EMERSON 2026`
- Telas 404 / Error: assinatura discreta no rodapé
- `<title>` e meta `author` em `__root.tsx`

## Detalhes técnicos

- Editados: `src/routes/index.tsx`, `src/routes/__root.tsx`, `mame-server.js`.
- Criados: `scripts/upscale_assets.py`, `scripts/upscale.sh`, `scripts/README.md`.
- Sem novas dependências npm — Python (Pillow) fica isolado fora do bundle.
- Mapeamento compatível com MAME 0.139+ (formato `<port>` / `<newseq>`).