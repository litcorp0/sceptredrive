# 17-02 — Field-scoped catalogue editing

**Goal:** a manager can fix a description without an admin, and cannot legally touch the
fields that decide what the product is.

**Must be true when done**

- A manager may `PATCH /api/products/:id` with `description` only, and it is audited.
- A manager sending `name`, `categoryId`, `brandId`, `uomId`, `taxCategory`, `basePriceMinor`
  or `barcodes` — even alongside a valid description — is refused with `403` naming the
  field. The description change in the same request does not land.
- Sending a protected field **with its current value** is not a refusal; only a real change
  is (the console posts whole forms).
- An admin is unaffected.
- The console renders protected fields read-only for a manager instead of letting them fail
  at save.

## Tasks

1. `packages/shared/src/permissions.ts`: add `catalog.describe`; grant to ADMIN and MANAGER.
2. `products.routes.ts`: PATCH accepts either `catalog.update` or `catalog.describe`.
3. `products.service.ts#updateProduct`: compute the diff against the stored row; if the actor
   is not an admin and any protected field actually moved, throw `ForbiddenError` whose
   message names the field and says who can change it.
4. `admin/src/modules/catalog`: the edit form takes a `canEditIdentity` prop (role-based) and
   renders those inputs disabled; description stays editable for managers.
5. Tests: manager description OK; manager name refused (403) with the description in the same
   payload not applied; manager sends an unchanged protected value and succeeds; admin edits
   name.

## Notes

- The authority lives in the service, not the route: a client that sends the field anyway
  must still be refused (OWASP A01).
- `catalog.update` stays admin-only, so a later reader cannot mistake the new permission for
  general update rights.

## Verification

`bunx vitest run src/modules/products`, plus the permissions test asserting the two roles.
