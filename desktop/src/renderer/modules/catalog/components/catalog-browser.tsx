import type { RefObject } from 'react'
import type { SellableProduct } from '@/lib/cart/types'
import { ProductSearch } from './product-search'
import { ScanListener } from './scan-listener'

/**
 * The catalogue column (Plan 06 Task 2), composed.
 *
 * One component because the three pieces are one job: the scanner, the search
 * field that also accepts a scan, and the grid that search renders. The sell
 * page imports this and nothing else from the module, so the pieces can change
 * shape in the counter redesign without the page knowing.
 *
 * The `<section>` is part of the composition so the sell page's grid keeps its
 * three columns. `ScanListener` renders nothing — it only binds the window.
 */
export function CatalogBrowser({
  branchId,
  focusRef,
  scanEnabled,
  onAdd,
  onUnknown,
  onScan,
}: {
  branchId: string
  focusRef: RefObject<HTMLInputElement | null>
  /** Scans are ignored while a dialog owns the keyboard. */
  scanEnabled: boolean
  onAdd: (product: SellableProduct) => void
  onUnknown: (code: string) => void
  onScan: (code: string) => void
}) {
  return (
    <>
      <ScanListener onScan={onScan} enabled={scanEnabled} />
      <section
        aria-label="Catalog"
        className="flex h-[60vh] min-h-[420px] min-w-0 flex-col border-border p-4 lg:h-auto lg:min-h-0 lg:border-r"
      >
        <ProductSearch
          branchId={branchId}
          focusRef={focusRef}
          onAdd={onAdd}
          onUnknown={onUnknown}
        />
      </section>
    </>
  )
}
