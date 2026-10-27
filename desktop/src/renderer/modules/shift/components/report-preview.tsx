import { reportDocumentText } from '@/lib/receipt/report-render'
import type { ReportDocument } from '../../../../shared/printing'

/**
 * The paper, on screen.
 *
 * It renders the **document's own 42-column text**, not a paraphrase of the
 * figures, so what the cashier reads is what the printer prints. A report is a
 * document, so it keeps the receipt's 80 mm monospace measure rather than a card
 * of labels.
 *
 * The `<figure>` carries the accessible name: `aria-label` on a bare `<pre>` is
 * not supported by its role, and a report the screen reader cannot name is a
 * report a blind cashier cannot check.
 */
export function ReportPreview({ document }: { document: ReportDocument }) {
  return (
    <figure
      data-testid="report-preview"
      aria-label={`${document.title} ${document.reference}`}
      className="mx-auto m-0 w-[80mm] max-w-full"
    >
      <pre className="overflow-x-auto rounded-md border border-border bg-card px-3 py-3 font-mono text-[11px] leading-relaxed whitespace-pre">
        {reportDocumentText(document)}
      </pre>
    </figure>
  )
}
