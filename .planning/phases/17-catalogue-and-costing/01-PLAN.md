# 17-01 — Duplicate detection on create and on submission

**Goal:** the same product cannot enter the catalogue twice by accident, and the person who
tries learns which SKU already owns the name or barcode.

**Must be true when done**

- Creating a product whose trimmed, case-insensitive name equals an existing product in the
  same category is refused with `409 PRODUCT_DUPLICATE`, and the message names the existing
  SKU.
- The same name in a *different* category is allowed.
- A barcode already owned by another product is refused with `409 BARCODE_IN_USE`, naming
  the owning SKU, instead of surfacing a unique violation as a 500.
- A manager's submission (`POST /api/products/submissions`) runs the same two checks, so the
  refusal happens before an admin ever sees the request.
- Nothing is created and no approval is raised when either check refuses.

## Tasks

1. `products.repository.ts`: add two reads — one by `(name, categoryId)` normalised, one by
   barcode — returning `{ id, sku }` only.
2. `products.service.ts#createProduct`: run both checks inside the existing transaction,
   before `insertProduct`. Codes: `PRODUCT_DUPLICATE`, `BARCODE_IN_USE`.
3. `products.service.ts#submitProduct`: run the same two checks before `requestApproval`.
4. One shared helper for the two checks so create and submit cannot drift.
5. Tests in `products.test.ts`: duplicate name+category, same name other category, duplicate
   barcode, duplicate submission; each asserts the status and the code, and that the product
   count is unchanged.

## Notes

- Comparison is `lower(trim(name))` in SQL, not in JavaScript: two clients looking at one
  row must agree.
- Barcodes are already unique in the database; this plan converts the database's answer into
  a sentence a manager can act on.

## Verification

`bunx vitest run src/modules/products` green, with the four new cases named above.
