import { formatCount } from "@sceptre/shared"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import type { QueueLink } from "../utils/queue"

const CARD_CLASSES =
	"grid min-w-0 gap-1 rounded-lg border bg-card p-4 text-card-foreground transition-colors hover:bg-accent/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"

function CardBody({ label, count, detail }: { label: string; count: number; detail?: ReactNode }) {
	return (
		<>
			<p className="text-sm text-muted-foreground">{label}</p>
			<p className="font-display text-2xl tabular-nums">{formatCount(count)}</p>
			{detail ? <div className="text-xs text-muted-foreground">{detail}</div> : null}
			<span className="mt-2 text-xs font-medium text-primary">View the list</span>
		</>
	)
}

/**
 * One queue's count, and the list it counts.
 *
 * The whole card is the link — there is no second "view" target competing with it — and the
 * target's filters are written by `queueLink`, so a count never opens an unfiltered list.
 */
export function QueueCard({
	link,
	label,
	count,
	detail,
}: {
	link: QueueLink
	label: string
	count: number
	detail?: ReactNode
}) {
	const body = <CardBody label={label} count={count} detail={detail} />

	switch (link.kind) {
		case "approvals":
		case "shiftVariances":
			return (
				<Link to="/approvals" search={link.search} className={CARD_CLASSES}>
					{body}
				</Link>
			)
		case "transferRequests":
			return (
				<Link to="/inventory/transfers" search={link.search} className={CARD_CLASSES}>
					{body}
				</Link>
			)
		case "writeOffs":
			return (
				<Link to="/inventory/write-offs" search={link.search} className={CARD_CLASSES}>
					{body}
				</Link>
			)
		case "lowStock":
			return (
				<Link to="/inventory/stock" search={link.search} className={CARD_CLASSES}>
					{body}
				</Link>
			)
		case "overLimitCredit":
			return (
				<Link to="/customers/over-limit" search={link.search} className={CARD_CLASSES}>
					{body}
				</Link>
			)
	}
}
