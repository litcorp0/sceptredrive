# 19-04 — Console: go-live wizard, proposal fields, prefilled stock action

**Goal:** the operator can take a spreadsheet to a posted opening without leaving the
console, and the misleading “adjustment” copy is gone.

**Must be true when done**

- Inventory has an **Opening stock** tab with a list (number, branch, status, counted date,
  units, counted value, new products, posted by/at) and a New action.
- The new page accepts an uploaded CSV or pasted text, parses it with the shared parser,
  previews it through the API, and shows per-row classification, variances, values, warnings
  and errors with a row number.
- The manager can save a clean preview as a draft; the admin sees **Post** and is the only
  role that can press it.
- The detail page shows the header, totals, every line, the uncosted warning, and the
  draft/posted state. A draft can be deleted; a posted document cannot.
- The product submission form has optional opening quantity and unit cost fields, shows the
  line value, and sends pesewas.
- The approval detail shows the proposed opening stock for a `PRODUCT_CREATE` request.
- An approved `PRODUCT_CREATE` offers **Open stock now** and opens the adjust dialog with the
  product already chosen (the 18-05 carry-forward).
- The adjust dialog no longer claims adjustments never change the average cost; it says an
  opening adjustment with a cost seeds it.
- Permission-gated controls are hidden for a manager (Post) and the server still refuses.

## Tasks

1. `admin/src/modules/inventory/api/openings.ts`, `api/keys.ts`, `types/index.ts`.
2. `pages/openings-page.tsx`, `pages/opening-new-page.tsx`, `pages/opening-detail-page.tsx`.
3. `components/opening-upload.tsx`, `components/opening-preview-table.tsx`,
   `components/opening-lines-table.tsx`.
4. `inventory-layout.tsx`: add the tab; `index.ts` exports.
5. `admin/src/routes/_authenticated/inventory/openings/*`: list, new, detail.
6. `adjust-dialog.tsx`: copy fix and optional `initialProduct`.
7. `approval-detail-page.tsx` / `product-subject.tsx`: opening stock display and Open stock.
8. `procurement/pages/product-submission-page.tsx` and `procurement/types/index.ts`: fields.
9. Empty/loading/error/denied states; keyboard labels; mobile layout follows the existing
   tables.

## Notes

- The client never computes a value that the server also decides: it renders the preview's
  numbers.
- CSV headers are matched exactly (case-insensitive, trimmed). The template is shown in the
  upload panel as a copyable header line.
- The file is parsed in the browser only to produce JSON rows; the server validates every
  field again (OWASP A03/A05).

## Verification

Admin typecheck, lint, and a browser walk-through of upload → preview → save draft → post as
admin; the manager sees the draft but no Post button.
