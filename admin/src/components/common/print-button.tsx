import { Printer } from "lucide-react"
import { Button } from "#/components/ui/button"

interface PrintButtonProps {
	/** What is printed, for the accessible name: "Print credit aging". */
	label: string
	/** Set while the report is still loading: printing a skeleton files a blank page. */
	disabled?: boolean
}

/**
 * Browser print, never a PDF pipeline (P14-D20).
 *
 * The printed page comes from the same DOM the screen renders, and `PrintSheet` supplies the
 * provenance block, so what leaves the printer says which period, branch and instant it is.
 */
export function PrintButton({ label, disabled }: PrintButtonProps) {
	return (
		<Button
			type="button"
			variant="outline"
			size="sm"
			onClick={() => window.print()}
			disabled={disabled}
			aria-label={`Print ${label}`}
			data-slot="print-button"
		>
			<Printer aria-hidden="true" className="size-4" />
			Print
		</Button>
	)
}
