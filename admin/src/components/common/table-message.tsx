import { TableCell, TableRow } from "#/components/ui/table"

export function TableMessage({
	colSpan,
	children,
	tone = "muted",
}: {
	colSpan: number
	children: React.ReactNode
	tone?: "muted" | "error"
}) {
	return (
		<TableRow>
			<TableCell
				colSpan={colSpan}
				className={
					tone === "error"
						? "py-8 text-center text-sm text-destructive"
						: "py-8 text-center text-sm text-muted-foreground"
				}
			>
				{children}
			</TableCell>
		</TableRow>
	)
}
