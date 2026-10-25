import { Download } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "#/components/ui/button"
import { ApiError } from "#/lib/api"
import { downloadReport } from "../api/analytics"
import type { AnalyticsQuery, ExportName } from "../types"

interface ExportButtonProps {
	report: ExportName
	query: AnalyticsQuery
	label: string
}

/**
 * Downloads the server-generated CSV for the view currently on screen.
 *
 * The same period, branch, and permission apply, so an export can never contain more than the
 * table it sits above. Money columns are raw pesewas; the tooltip says so, because a
 * spreadsheet reader will otherwise assume cedis.
 */
export function ExportButton({ report, query, label }: ExportButtonProps) {
	const [pending, setPending] = useState(false)

	async function download() {
		setPending(true)
		try {
			const { blob, filename } = await downloadReport(report, query)
			const url = URL.createObjectURL(blob)
			const anchor = document.createElement("a")
			anchor.href = url
			anchor.download = filename
			document.body.append(anchor)
			anchor.click()
			anchor.remove()
			URL.revokeObjectURL(url)
			toast.success(`${label} CSV downloaded`)
		} catch (error) {
			const message = error instanceof ApiError ? error.message : "The export failed."
			toast.error(`Could not export ${label.toLowerCase()}.`, { description: message })
		} finally {
			setPending(false)
		}
	}

	return (
		<Button
			type="button"
			variant="outline"
			size="sm"
			onClick={download}
			disabled={pending}
			title="Amounts are in pesewas"
		>
			<Download aria-hidden="true" className="size-4" />
			{pending ? "Preparing…" : "Export CSV"}
		</Button>
	)
}
