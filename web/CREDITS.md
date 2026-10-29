# Photo credits

The website ships a local copy of this photograph. It was resized and converted
to AVIF/WebP; no other changes were made.

| File | Title | Author | Licence | Source |
|---|---|---|---|---|
| `workshop-bench` | Car mechanic's workbench (Unsplash) | AJ Yorio | CC0 1.0 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Car_mechanic%27s_workbench_(Unsplash).jpg) |

## Replacing a photo

1. Put the new file in `web/public/photos/` in both `.avif` and `.webp`, using
   the same base name.
2. Keep the intrinsic `width`/`height` in the component honest; they reserve the
   space and prevent layout shift.
3. Update this table with the title, author, licence and source.

The `Photo` component (`src/components/photo.tsx`) is the only place an image is
rendered, so a swap never needs a layout change.
