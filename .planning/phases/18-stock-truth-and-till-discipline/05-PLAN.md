# 18-05 — Approval to stock

**Must be true:** after a `PRODUCT_CREATE` approval the admin is offered a way to put stock on
the shelf immediately, prefilled with the approved product.

Tasks
1. `AdjustDialog` accepts an optional `initialProduct`.
2. The approval detail for `PRODUCT_CREATE`, once decided `APPROVED`, shows "Open stock now"
   which opens that dialog.
3. The stock list's never-stocked row offers the same action for a product that was never
   stocked.

Verification: console typecheck; the approval detail renders the action for an approved
product and not for a pending one.
