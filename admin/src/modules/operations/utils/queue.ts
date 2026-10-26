/**
 * Where each operations card goes.
 *
 * One place knows every list URL and its filters, so a card and the list it counts cannot drift.
 * The union is keyed by `kind`, and the card's renderer narrows on it, which keeps TanStack's
 * typed `Link` honest: a filter the target route does not validate is a compile error.
 */
export type QueueKind =
	| "approvals"
	| "shiftVariances"
	| "transferRequests"
	| "writeOffs"
	| "lowStock"
	| "overLimitCredit"

export type QueueLink =
	| {
			kind: "approvals"
			to: "/approvals"
			search: { status: "PENDING"; branchId?: string | "ALL" }
	  }
	| {
			kind: "shiftVariances"
			to: "/approvals"
			search: {
				status: "PENDING"
				type: "SHIFT_VARIANCE_REVIEW"
				branchId?: string | "ALL"
			}
	  }
	| {
			kind: "transferRequests"
			to: "/inventory/transfers"
			search: { status: "REQUESTED"; branchId?: string }
	  }
	| {
			kind: "writeOffs"
			to: "/inventory/write-offs"
			search: { status: "PENDING_APPROVAL"; branchId?: string }
	  }
	| {
			kind: "lowStock"
			to: "/inventory/stock"
			search: { lowStock: "true"; branchId?: string }
	  }
	| {
			kind: "overLimitCredit"
			to: "/customers/over-limit"
			search: { branchId?: string }
	  }

export function queueLink(kind: QueueKind, branchId: string | null): QueueLink {
	const scoped = branchId ?? undefined

	switch (kind) {
		case "approvals":
			return {
				kind,
				to: "/approvals",
				search: { status: "PENDING", branchId: branchId ?? "ALL" },
			}
		case "shiftVariances":
			return {
				kind,
				to: "/approvals",
				search: {
					status: "PENDING",
					type: "SHIFT_VARIANCE_REVIEW",
					branchId: branchId ?? "ALL",
				},
			}
		case "transferRequests":
			return {
				kind,
				to: "/inventory/transfers",
				search: { status: "REQUESTED", branchId: scoped },
			}
		case "writeOffs":
			return {
				kind,
				to: "/inventory/write-offs",
				search: { status: "PENDING_APPROVAL", branchId: scoped },
			}
		case "lowStock":
			return { kind, to: "/inventory/stock", search: { lowStock: "true", branchId: scoped } }
		case "overLimitCredit":
			return { kind, to: "/customers/over-limit", search: { branchId: scoped } }
	}
}
