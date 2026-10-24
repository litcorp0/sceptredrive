# @sceptre/brand

**One rule: brand values live here and nowhere else.**

This package owns the single source of truth for Sceptre Drive's visual identity:

| File | Owns |
|---|---|
| `src/tokens.css` | colour, radius, shadow, chart ramp, shadcn surface mapping, layout tokens |
| `src/fonts.css` | the three self-hosted typefaces and their Tailwind `@theme` roles |

It has **no build step**: it exports CSS source, exactly like `@sceptre/shared` exports
TypeScript source. Both clients import the files directly:

```css
@import "@sceptre/brand/tokens.css";
@import "@sceptre/brand/fonts.css";
```

## What belongs here

- Colours, including every state and semantic colour.
- Typefaces, weights, and the `--font-*` role mapping.
- Corner radius and shadows.
- The chart ramp (`--chart-1` … `--chart-5`).

## What does not

- **Layout tokens** (widths, z-index, breakpoints) may live in an app. Nothing visual that
  a second app would have to copy.
- **Component styles.** Primitives belong to the app's `components/ui`.

A brand hex value anywhere outside this package is a bug. `bun run brand:check` is about the
product name; the rule here is enforced by review and by `grep` in the phase verification.

The reasoning behind these values (contrast measurements, the workshop-fascia direction, the
Till Line) is in `design-system/sceptre-drive/MASTER.md`. If the two disagree, this package
wins and the document is corrected.
