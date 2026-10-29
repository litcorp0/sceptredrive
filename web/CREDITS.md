# Photo credits

The website ships local copies of these photographs. Each was resized and
converted to AVIF/WebP; no other changes were made. The licence and author are
recorded here because a downloaded image without provenance is a liability.

| File | Title | Author | Licence | Source |
|---|---|---|---|---|
| `workshop-bench` | Car mechanic's workbench (Unsplash) | AJ Yorio | CC0 1.0 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Car_mechanic%27s_workbench_(Unsplash).jpg) |
| `engine-block` | Close-up of an engine extracted from a car, with many disassembled parts | Ivan Radic | CC BY 2.0 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Close-up_of_an_engine_extracted_from_a_car,_with_many_disassembled_parts_(51145344822).jpg) |
| `suspension-work` | Car mechanic worker repairing suspension with drill in garage | Shixart1985 | CC BY 2.0 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Car_mechanic_worker_repairing_suspension_with_drill_in_garage.jpg) |
| `brake-rotor` | Ventilated Plain (Smooth) Brake Rotor | Atharv Chandel | CC BY 4.0 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Ventilated_Plain_(Smooth)_Brake_Rotor.jpg) |

## Replacing a photo

1. Put the new file in `web/public/photos/` in both `.avif` and `.webp`, using
   the same base name.
2. Keep the intrinsic `width`/`height` in the component honest; they reserve the
   space and prevent layout shift.
3. Update this table with the title, author, licence and source.

The `Photo` component (`src/components/photo.tsx`) is the only place an image is
rendered, so a swap never needs a layout change.
