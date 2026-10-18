import { cn } from "cn"
import type { ReactNode } from "react"
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "#/components/ui/alert-dialog"

export function ConfirmDialog({
	open,
	onOpenChange,
	title,
	description,
	confirmLabel = "Confirm",
	destructive = false,
	pending = false,
	onConfirm,
	children,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	title: string
	description?: ReactNode
	confirmLabel?: string
	destructive?: boolean
	pending?: boolean
	onConfirm: () => void
	children?: ReactNode
}) {
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{title}</AlertDialogTitle>
					{description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
				</AlertDialogHeader>
				{children}
				<AlertDialogFooter>
					<AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
					<AlertDialogAction
						disabled={pending}
						className={cn(destructive && "bg-destructive text-white hover:bg-destructive/90")}
						onClick={(event) => {
							event.preventDefault()
							onConfirm()
						}}
					>
						{pending ? "Working…" : confirmLabel}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
