/**
 * `catalog` — products, categories, brands and units, shared across every branch.
 *
 * Migration note (Phase 8): the catalog section was 1,421 route lines across eight files and seven
 * components under `components/catalog/`. The section layout is now a page (`CatalogLayout`) and
 * every route renders one page and nothing else (decisions D6, D9 — a move, not a rewrite).
 */
export { CatalogLayout } from "./pages/catalog-layout"
