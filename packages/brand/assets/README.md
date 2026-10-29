# Brand assets

The supplied artwork and its derived files. **This folder is the only master.** The three
apps receive copies through `bun run brand:assets` (`scripts/sync-brand-assets.mjs`), so a
header, a login screen and a favicon cannot drift apart.

| File | Use |
|---|---|
| `logo-source.jpg` | The supplied original (1254×1254, light `#F0F0F0` background). Provenance only; never shipped. |
| `logo.png` | Transparent lockup, charcoal wordmark + orange mark. Light surfaces. |
| `logo-inverse.png` | Transparent lockup, off-white wordmark + orange mark. Charcoal surfaces. |
| `logo-icon.png` | Padded 512×512 square for favicons and touch icons. |

## How they were produced

ImageMagick 7 (`magick`), from `logo-source.jpg`. The background is removed by flood-filling
the four corners rather than colour-keying the whole image: the near-white highlight inside
the wrench is enclosed and must survive.

```bash
cd packages/brand/assets

# 1. Remove only the connected background, then crop to content.
magick logo-source.jpg -alpha set -fuzz 9% \
  -fill none -draw 'color 0,0 floodfill' \
  -fill none -draw 'color 1253,0 floodfill' \
  -fill none -draw 'color 0,1253 floodfill' \
  -fill none -draw 'color 1253,1253 floodfill' \
  -trim +repage -strip logo.png

# 2. Recolour the charcoal wordmark for dark surfaces, leaving the orange intact.
magick logo.png -fuzz 12% -fill '#F6F6F4' -opaque '#1b1f23' -strip logo-inverse.png

# 3. Fit the lockup into a padded square for icons.
magick logo.png -resize 430x -background none -gravity center \
  -extent 512x512 -strip logo-icon.png
```

Expected: `logo.png` and `logo-inverse.png` are 1159×504 RGBA, `logo-icon.png` is 512×512.

## Rules

- Do not recolour or crop the mark in an app. If a surface needs a variant, add it here and
  sync it.
- The wordmark is a raster; it stays sharp to roughly 360 px wide. Headers and login use it
  at ≤ 220 px. Do not stretch it into a hero.
- The collapsed admin rail and the favicon use `logo-icon.png` or the documented `SD`
  monogram; an emblem-only crop is not clean because the "DRIVE" letters overlap the gear.
- If the original vector (AI/SVG/PDF) arrives, replace these files with exports from it and
  regenerate the icon; the layout does not change.
