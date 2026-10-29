import { formatCount, formatDateTime } from "@sceptre/shared"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { toast } from "sonner"
import { CopyButton } from "#/components/common/copy-button"
import { StatusBadge } from "#/components/common/status-badge"
import { Button } from "#/components/ui/button"
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "#/components/ui/sheet"
import { Skeleton } from "#/components/ui/skeleton"
import { ApiError } from "#/lib/api"
import { toastApiError } from "#/lib/toast"
import { evatDetailOptions, retryEvatSubmission } from "../api/evat"
import { evatKeys } from "../api/keys"
import type { EvatSubmissionView } from "../types"
import { groupSignature } from "../utils/labels"
import { EVAT_KIND_LABELS } from "./evat-filters"
import { EvatStatusBadge, OverdueBadge } from "./evat-status-badge"

const INLINE_ERROR_STATUSES = new Set([400, 403, 409])

/**
 * One submission, the certificate when there is one, and the provider's words when there is not.
 *
 * The certificate fields are rendered exactly as stored — the signature in four groups, the
 * internal data truncated with a copy control, the QR payload as text. The sheet never invents a
 * URL from the payload and never links to GRA: the certificate is a record, not a destination.
 */
export function EvatDetailSheet({
	submissionId,
	canRetry,
	branches,
	onClose,
}: {
	submissionId: string | null
	canRetry: boolean
	branches: Array<{ id: string; name: string }>
	onClose: () => void
}) {
	const queryClient = useQueryClient()
	const query = useQuery({
		...evatDetailOptions(submissionId as string),
		enabled: submissionId !== null,
	})

	const retryMutation = useMutation({
		mutationFn: (id: string) => retryEvatSubmission(id),
		onSuccess: async () => {
			toast.success("Retry queued")
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: evatKeys.submissions }),
				queryClient.invalidateQueries({ queryKey: evatKeys.summary }),
				queryClient.invalidateQueries({ queryKey: evatKeys.health }),
				queryClient.invalidateQueries({ queryKey: evatKeys.submission }),
			])
		},
		onError: (error) => toastApiError(error),
	})

	const submission = query.data
	const retryError =
		retryMutation.error instanceof ApiError && INLINE_ERROR_STATUSES.has(retryMutation.error.status)
			? retryMutation.error.message
			: null

	return (
		<Sheet
			open={submissionId !== null}
			onOpenChange={(open) => {
				if (!open) onClose()
			}}
		>
			<SheetContent className="w-full overflow-y-auto sm:max-w-xl">
				<SheetHeader>
					<SheetTitle>E-VAT submission</SheetTitle>
					<SheetDescription>
						What was sent to GRA, what came back, and the one action an administrator can take.
					</SheetDescription>
				</SheetHeader>

				{query.isLoading ? (
					<div className="grid gap-2 px-4" aria-busy="true">
						<output className="sr-only">Loading the submission</output>
						<Skeleton className="h-5 w-48" />
						<Skeleton className="h-24 w-full" />
						<Skeleton className="h-24 w-full" />
					</div>
				) : query.isError || !submission ? (
					<p role="alert" className="px-4 text-sm text-destructive">
						Couldn&rsquo;t load this submission.
					</p>
				) : (
					<div className="grid gap-4 px-4 pb-6">
						<div className="flex flex-wrap items-center gap-2">
							<EvatStatusBadge status={submission.status} />
							<OverdueBadge overdue={submission.overdue} />
							<span className="text-xs text-muted-foreground">
								{EVAT_KIND_LABELS[submission.kind]} · {submission.documentNumber ?? submission.id}
							</span>
						</div>

						<DocumentLink submission={submission} />

						<dl className="grid gap-2 text-sm">
							<Fact
								label="Branch"
								value={branches.find((branch) => branch.id === submission.branchId)?.name ?? "—"}
							/>
							<Fact label="Terminal" value={submission.terminalId} mono />
							<Fact label="Provider" value={submission.provider} />
							<Fact label="Created" value={formatDateTime(submission.createdAt)} />
							<Fact label="Deadline" value={formatDateTime(submission.dueAt)} />
							<Fact label="Attempts" value={formatCount(submission.attempts)} />
							<Fact
								label="Next attempt"
								value={submission.nextAttemptAt ? formatDateTime(submission.nextAttemptAt) : "—"}
							/>
							<Fact
								label="Submitted"
								value={submission.submittedAt ? formatDateTime(submission.submittedAt) : "—"}
							/>
							<Fact
								label="Certified"
								value={submission.certifiedAt ? formatDateTime(submission.certifiedAt) : "—"}
							/>
						</dl>

						{submission.certificate ? (
							<CertificatePanel submission={submission} />
						) : (
							<section aria-labelledby="evat-refusal" className="grid gap-2">
								<h3 id="evat-refusal" className="text-sm font-medium">
									The provider&rsquo;s answer
								</h3>
								{submission.status === "WAITING_FOR_INVOICE" ? (
									<p className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
										This refund waits for its sale&rsquo;s invoice to be certified. Retrying it
										before then would earn the same refusal.
									</p>
								) : null}
								{submission.lastErrorCode || submission.lastErrorMessage ? (
									<div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
										{submission.lastErrorCode ? (
											<p className="font-mono text-xs font-medium">{submission.lastErrorCode}</p>
										) : null}
										<p className="mt-1 whitespace-pre-wrap">
											{submission.lastErrorMessage ?? "No message was recorded."}
										</p>
									</div>
								) : (
									<p className="text-sm text-muted-foreground">
										No refusal has been recorded. The certificate is not present yet.
									</p>
								)}
							</section>
						)}

						{canRetry && submission.status !== "CERTIFIED" && submission.status !== "SUBMITTING" ? (
							<div className="grid gap-2 border-t pt-3">
								<Button
									type="button"
									size="sm"
									disabled={retryMutation.isPending}
									onClick={() => retryMutation.mutate(submission.id)}
								>
									{retryMutation.isPending ? "Queueing…" : "Retry submission"}
								</Button>
								<p className="text-xs text-muted-foreground">
									Retrying keeps the attempt history and queues the document again. It cannot undo a
									certification.
								</p>
								{retryError ? (
									<p role="alert" className="text-sm text-destructive">
										{retryError}
									</p>
								) : null}
							</div>
						) : null}
					</div>
				)}
			</SheetContent>
		</Sheet>
	)
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
	return (
		<div className="flex justify-between gap-4">
			<dt className="text-muted-foreground">{label}</dt>
			<dd className={mono ? "max-w-64 truncate font-mono text-xs" : "max-w-64 text-right"}>
				{value}
			</dd>
		</div>
	)
}

function DocumentLink({ submission }: { submission: EvatSubmissionView }) {
	if (!submission.saleId && !submission.refundId) return null
	return (
		<p className="text-sm">
			{submission.saleId ? (
				<Link
					to="/pos/sales/$saleId"
					params={{ saleId: submission.saleId }}
					className="font-medium text-brand-ink hover:underline"
				>
					Open the sale
				</Link>
			) : submission.refundId ? (
				<Link
					to="/pos/refunds/$refundId"
					params={{ refundId: submission.refundId }}
					className="font-medium text-brand-ink hover:underline"
				>
					Open the refund
				</Link>
			) : null}
		</p>
	)
}

function CertificatePanel({ submission }: { submission: EvatSubmissionView }) {
	const certificate = submission.certificate
	if (!certificate) return null
	const signatureGroups = groupSignature(certificate.signature)

	return (
		<section aria-labelledby="evat-certificate" className="grid gap-2">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h3 id="evat-certificate" className="text-sm font-medium">
					Certificate
				</h3>
				<StatusBadge variant="ok">Stamped</StatusBadge>
			</div>
			<dl className="grid gap-2 text-sm">
				<Fact label="GRA receipt number" value={certificate.providerInvoiceNumber} mono />
				<Fact label="SDC ID" value={certificate.sdcId} mono />
				<Fact label="Serial" value={certificate.serial} mono />
				<Fact label="Machine code" value={certificate.machineCode} mono />
				<Fact label="Stamped at" value={formatDateTime(certificate.stampedAt)} />
			</dl>

			<div className="grid gap-1">
				<p className="text-xs font-medium text-muted-foreground">Signature</p>
				<p className="flex flex-wrap gap-2 font-mono text-xs">
					{signatureGroups.map((group, index) => (
						<span key={`${group}-${index}`} className="rounded border px-1.5 py-0.5">
							{group}
						</span>
					))}
				</p>
			</div>

			<div className="grid gap-1">
				<p className="text-xs font-medium text-muted-foreground">Internal data</p>
				<div className="flex items-start gap-2">
					<p className="min-w-0 flex-1 truncate font-mono text-xs" title={certificate.internalData}>
						{certificate.internalData}
					</p>
					<CopyButton value={certificate.internalData} label="Copy internal data" />
				</div>
			</div>

			<div className="grid gap-1">
				<p className="text-xs font-medium text-muted-foreground">QR payload</p>
				<p className="font-mono text-xs break-all">{certificate.qrPayload}</p>
			</div>
		</section>
	)
}
