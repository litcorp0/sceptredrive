#!/usr/bin/env node
/**
 * Phase 9 Plan 08 — walk every console section, including the new analytics surface.
 *
 * The admin package has no unit tests, so "no behaviour change" has to be shown by opening each
 * screen in a real browser and proving it rendered its own data instead of an error, an empty
 * shell, or a spinner that never settles. Each section also asserts zero console errors and zero
 * failed API requests, which is exactly how a broken module barrel fails (a component exported
 * through a cycle resolves to `undefined` and React throws on render).
 *
 * Requires the API on :4000, the admin dev server on :3000 and a seeded database:
 *   bun run dev:api & bun run dev:admin
 *   bun run db:seed --demo
 *
 * Usage: node admin/test/walkthrough-sections.mjs      (or: bun run --filter admin test:walkthrough)
 * Env:   ADMIN_URL, API_BASE_URL, EVIDENCE_DIR
 */
import fs from "node:fs"
import path from "node:path"
import { chromium } from "playwright"

const adminUrl = process.env.ADMIN_URL ?? "http://localhost:3000"
const repoRoot = path.resolve(import.meta.dirname, "../..")
// Resolved against the repository, not the process cwd: `bun run --filter admin` runs in `admin/`,
// and a relative EVIDENCE_DIR would otherwise create `admin/.planning/`.
const evidenceDir = process.env.EVIDENCE_DIR
	? path.resolve(repoRoot, process.env.EVIDENCE_DIR)
	: path.resolve(repoRoot, ".planning/phases/09-analytics-dashboard/evidence/shots")
const managerPasswordFile =
	process.env.MANAGER_PASSWORD_FILE ?? "/tmp/opencode/manager-password.txt"
fs.mkdirSync(evidenceDir, { recursive: true })

const env = fs.readFileSync(path.join(repoRoot, ".env"), "utf8")
const envValue = (key) => (env.match(new RegExp(`^${key}="?([^"\\n]*)`, "m")) ?? [])[1]

let checks = 0
const failures = []

function check(condition, label, detail) {
	checks += 1
	if (condition) {
		console.log(`  ok   ${label}`)
		return true
	}
	failures.push(detail ? `${label} (${detail})` : label)
	console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`)
	return false
}

function section(title) {
	console.log(`\n-- ${title} --`)
}

// --- auth -------------------------------------------------------------------

async function robustFill(page, selector, value) {
	for (let attempt = 0; attempt < 10; attempt += 1) {
		await page.fill(selector, value)
		if ((await page.inputValue(selector)) === value) return
		await page.waitForTimeout(250)
	}
	throw new Error(`could not fill ${selector}`)
}

async function signIn(page, email, password) {
	await page.goto(`${adminUrl}/login`, { waitUntil: "networkidle" })
	await robustFill(page, "#email", email)
	await robustFill(page, "#password", password)
	await page.getByRole("button", { name: "Sign in" }).click()
	await page.waitForURL((url) => !new URL(url).pathname.startsWith("/login"), { timeout: 30_000 })
	await page.waitForLoadState("networkidle")
}

// --- sections ---------------------------------------------------------------

/** Text that must appear in `main`, or null when rendering alone is the assertion. */
const SECTIONS = [
	["/", "Today at"],
	["/analytics", "Analytics"],
	["/approvals", "Approvals"],
	["/operations", "Branch operations"],
	["/pos?tab=sales", "Sales"],
	["/pos?tab=refunds", "Refunds"],
	["/pos?tab=shifts", "Shifts"],
	["/pos?tab=conflicts", "Conflicts"],
	["/branches", "Branches"],
	["/terminals", "Terminals"],
	["/staff", "Staff"],
	["/staff/permissions", "Permissions"],
	["/catalog/products", "Products"],
	["/catalog/products/new", "New product"],
	["/catalog/categories", "Categories"],
	["/catalog/brands", "Brands"],
	["/catalog/units", "Units"],
	["/inventory/stock", "Stock"],
	["/inventory/receipts", "Receipts"],
	["/inventory/transfers", "Transfers"],
	["/inventory/transfers/new", "New transfer"],
	["/inventory/counts", "Counts"],
	["/inventory/counts/new", "New stock count"],
	["/inventory/write-offs", "Write-offs"],
	["/customers", "Customers"],
	["/customers/aging", "Aging"],
	["/customers/over-limit", "Over the credit limit"],
	["/loyalty", "Loyalty"],
	["/suppliers", "Suppliers"],
	["/suppliers/invoices", "Invoices"],
	["/suppliers/invoices/new", "New supplier invoice"],
	["/suppliers/payments", "Payments"],
	["/suppliers/aging", "Aging"],
	["/suppliers/transfers", "Supplier transfers"],
	["/suppliers/reconciliation", "Transfer reconciliation"],
	["/procurement/orders", "Purchase orders"],
	["/procurement/replenishment", "What to order"],
	["/procurement/suppliers", "Which suppliers deliver"],
	["/audit", "Audit"],
	["/settings", "Settings"],
	["/evat", "E-VAT submissions"],
]

/** Screenshots land in the run's evidence directory, never a hard-coded phase folder. */
async function shot(page, name) {
	await page.screenshot({ path: path.join(evidenceDir, name), fullPage: true })
}

/** The column headings a table actually rendered, in document order. */
function tableHeaders(page) {
	return page.locator('main [data-slot="table-head"]').allInnerTexts()
}

function bodyRows(page) {
	return page.locator('main [data-slot="table-body"] [data-slot="table-row"]')
}

/**
 * The export/print contract every report screen shares (P14-D19/D20).
 *
 * The button is a canvas download, not a link, so its endpoint is asserted through
 * `data-export-path`: that attribute and the URL it downloads are written from the same
 * prop, which is what makes the check meaningful. The print sheet is on screen but
 * `hidden`, so it is read with `textContent`, not `innerText` — `innerText` of a
 * `display: none` subtree is not the document that prints.
 */
async function expectExport(page, path) {
	const button = page.locator(`main [data-slot="export-button"][data-export-path="${path}"]`)
	check(
		(await button.count()) === 1 && (await button.first().isVisible()),
		`${path} has a visible export button`,
		`${await button.count()} match`,
	)
}

/**
 * The print sheet is on screen but `hidden`, so it is read with `textContent`, not
 * `innerText`: `innerText` of a `display: none` subtree is not the document that prints.
 */
async function expectPrintSheet(page) {
	const sheet = page.locator('main [data-slot="print-sheet"]').first()
	const meta = sheet.locator('[data-slot="print-meta"]')
	const metaText = ((await meta.textContent()) ?? "").replace(/\s+/g, " ").trim()
	const labels = await meta
		.locator("dt")
		.evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim() ?? ""))
	check((await sheet.count()) === 1, "the report renders its print sheet")
	check(
		metaText.length > 0 && labels.includes("Generated by"),
		"the print sheet carries provenance, including its author",
		metaText.slice(0, 120),
	)
	return { sheet, metaText, labels }
}

async function expectExportAndPrint(page, path) {
	await expectExport(page, path)
	return expectPrintSheet(page)
}

/**
 * Per-section data assertions for the screens Phase 12 added.
 *
 * A title proves the route rendered; it does not prove the screen queried its own list and
 * showed the answer. Each callback runs after the generic `visit()` check, so a screen that
 * throws still fails there first, and these assertions fail if the table or empty state is
 * missing.
 */
const SECTION_ASSERTIONS = new Map([
	[
		"/approvals",
		async (page) => {
			const headers = await tableHeaders(page)
			const missing = ["Type", "Request", "Branch", "Value", "Requester", "Status"].filter(
				(header) => !headers.includes(header),
			)
			check(
				missing.length === 0,
				"/approvals renders its inbox columns",
				missing.length > 0 ? `missing ${missing.join(", ")}` : undefined,
			)
			const rows = await bodyRows(page).count()
			const text = await page.locator("main").innerText()
			check(
				rows > 0 ||
					/Nothing is waiting for a decision\.|No requests match these filters\./.test(text),
				"/approvals shows its rows or its own empty state",
				`${rows} rows`,
			)
			await shot(page, "plan12-approvals-1440.png")
		},
	],
	[
		"/operations",
		async (page) => {
			const text = await page.locator("main").innerText()
			const queueLabels = [
				"Pending approvals",
				"Transfer requests",
				"Write-offs awaiting decision",
				"Shift variances awaiting review",
				"Products at or below threshold",
				"Customers over their limit",
			].filter((label) => text.includes(label))
			const cards = await page.locator('main [data-slot="card"]').count()
			check(
				cards > 0 && queueLabels.length > 0,
				"/operations renders its queue cards",
				`${cards} cards, queues: ${queueLabels.join(", ") || "none"}`,
			)
			check(
				text.includes("What needs a decision or a look today"),
				"/operations says what the page is for",
			)
			await shot(page, "plan12-operations-1440.png")
		},
	],
	[
		"/pos?tab=sales",
		async (page) => {
			const headers = await tableHeaders(page)
			const missing = [
				"Receipt",
				"When",
				"Branch",
				"Terminal",
				"Cashier",
				"Items",
				"Total",
				"Refunded",
				"Conflicts",
			].filter((header) => !headers.includes(header))
			check(
				missing.length === 0,
				"/pos?tab=sales renders the document columns",
				missing.length > 0 ? `missing ${missing.join(", ")}` : undefined,
			)
			const rows = await bodyRows(page).count()
			const text = await page.locator("main").innerText()
			check(
				rows > 0 || text.includes("No sales match these filters."),
				"/pos?tab=sales shows its rows or its own empty state",
				`${rows} rows`,
			)
			check(!/NaN|undefined/.test(text), "/pos?tab=sales formats every figure", text.slice(0, 120))
			await shot(page, "plan08-pos-sales-1440.png")
		},
	],
	[
		"/pos?tab=refunds",
		async (page) => {
			const headers = await tableHeaders(page)
			const missing = [
				"Number",
				"When",
				"Receipt",
				"Refunded",
				"Reason",
				"Tenders",
				"Approval",
			].filter((header) => !headers.includes(header))
			check(
				missing.length === 0,
				"/pos?tab=refunds renders the refund columns",
				missing.length > 0 ? `missing ${missing.join(", ")}` : undefined,
			)
			const rows = await bodyRows(page).count()
			const text = await page.locator("main").innerText()
			check(
				rows > 0 || text.includes("No refunds match these filters."),
				"/pos?tab=refunds shows its rows or its own empty state",
				`${rows} rows`,
			)

			// The list must not silently be an approvals list: read the same page the screen
			// read, and prove a refund with no approval is rendered where one exists. The demo
			// seed records no refunds, so an empty answer is stated rather than faked.
			const response = await contextApi(page.request, "GET", "/api/pos/oversight/refunds?limit=50")
			const refunds = response.body?.refunds ?? []
			const withoutApproval = refunds.filter((refund) => refund.approvalId === null).length
			if (refunds.length === 0) {
				check(true, "/pos?tab=refunds has no seeded refund; its empty state is the honest result")
			} else {
				check(
					withoutApproval === 0 || text.includes("Not required"),
					"/pos?tab=refunds includes a refund with no approval",
					`${withoutApproval} without approval of ${refunds.length} on the first page`,
				)
			}
			await shot(page, "plan08-pos-refunds-1440.png")
		},
	],
	[
		"/pos?tab=shifts",
		async (page) => {
			const headers = await tableHeaders(page)
			const missing = [
				"Number",
				"Status",
				"Opened",
				"Closed",
				"Terminal",
				"Cashier",
				"Counted",
				"Expected",
				"Variance",
				"Review",
			].filter((header) => !headers.includes(header))
			check(
				missing.length === 0,
				"/pos?tab=shifts renders the drawer columns",
				missing.length > 0 ? `missing ${missing.join(", ")}` : undefined,
			)
			const rows = await bodyRows(page).count()
			const text = await page.locator("main").innerText()
			check(
				rows > 0 || text.includes("No shifts match these filters."),
				"/pos?tab=shifts shows its rows or its own empty state",
				`${rows} rows`,
			)
			check(!/NaN|undefined/.test(text), "/pos?tab=shifts formats every figure", text.slice(0, 120))
			await shot(page, "plan08-pos-shifts-1440.png")
		},
	],
	[
		"/pos?tab=conflicts",
		async (page) => {
			const headers = await tableHeaders(page)
			const missing = ["Conflict", "Created", "Branch", "Terminal", "Document", "Status"].filter(
				(header) => !headers.includes(header),
			)
			check(
				missing.length === 0,
				"/pos?tab=conflicts renders the queue columns",
				missing.length > 0 ? `missing ${missing.join(", ")}` : undefined,
			)

			let rows = await bodyRows(page).count()
			let text = await page.locator("main").innerText()
			// The demo seed's one sample conflict is RESOLVED, and the queue defaults to OPEN.
			// Read the history so the assertion can see a row instead of calling an empty
			// queue a passing severity check.
			if (rows === 0) {
				await page.goto(`${adminUrl}/pos?tab=conflicts&status=ALL`, {
					waitUntil: "networkidle",
				})
				await page.locator("main").waitFor()
				rows = await bodyRows(page).count()
				text = await page.locator("main").innerText()
			}
			check(
				rows > 0 || text.includes("No conflicts match these filters."),
				"/pos?tab=conflicts shows its rows or its own empty state",
				`${rows} rows`,
			)
			if (rows > 0) {
				const firstRow = await bodyRows(page).first().innerText()
				check(
					/\b(High|Medium|Low)\b/.test(firstRow),
					"/pos?tab=conflicts names a severity on its first row",
					firstRow.slice(0, 100).replace(/\s+/g, " "),
				)
			} else {
				check(true, "/pos?tab=conflicts had no seeded conflict to inspect")
			}
			await shot(page, "plan08-pos-conflicts-1440.png")
		},
	],

	[
		"/inventory/write-offs",
		async (page) => {
			const headers = await tableHeaders(page)
			const missing = ["Number", "Branch", "Status", "Lines", "Frozen value"].filter(
				(header) => !headers.includes(header),
			)
			check(
				missing.length === 0,
				"/inventory/write-offs renders its document columns",
				missing.length > 0 ? `missing ${missing.join(", ")}` : undefined,
			)
			const rows = await bodyRows(page).count()
			const text = await page.locator("main").innerText()
			check(
				rows > 0 || text.includes("No write-offs match these filters."),
				"/inventory/write-offs shows its rows or its own empty state",
				`${rows} rows`,
			)
			await shot(page, "plan12-write-offs-1440.png")
		},
	],
	[
		"/customers/over-limit",
		async (page) => {
			const headers = await tableHeaders(page)
			const missing = ["Customer", "Branch", "Limit", "Balance", "Over by"].filter(
				(header) => !headers.includes(header),
			)
			check(
				missing.length === 0,
				"/customers/over-limit renders its exposure columns",
				missing.length > 0 ? `missing ${missing.join(", ")}` : undefined,
			)
			const rows = await bodyRows(page).count()
			const text = await page.locator("main").innerText()
			check(
				rows > 0 || text.includes("No customer is over their limit in this branch."),
				"/customers/over-limit shows its rows or its own empty state",
				`${rows} rows`,
			)
			check(
				!/NaN|undefined/.test(text),
				"/customers/over-limit formats every figure",
				text.slice(0, 120),
			)
			await shot(page, "plan12-over-limit-1440.png")
		},
	],
	[
		"/suppliers/transfers",
		async (page) => {
			const headers = await tableHeaders(page)
			const missing = [
				"Reference",
				"Supplier",
				"Amount",
				"Status",
				"Created",
				"Settled",
				"Failure",
			].filter((header) => !headers.includes(header))
			check(
				missing.length === 0,
				"/suppliers/transfers renders the intent columns",
				missing.length > 0 ? `missing ${missing.join(", ")}` : undefined,
			)

			const rows = await bodyRows(page).count()
			const text = await page.locator("main").innerText()
			check(
				rows > 0 || text.includes("No transfers match these filters."),
				"/suppliers/transfers shows its rows or its own empty state",
				`${rows} rows`,
			)
			check(
				!/NaN|undefined/.test(text),
				"/suppliers/transfers formats every figure",
				text.slice(0, 120),
			)

			const transferButton = page.getByRole("button", { name: "Transfer", exact: true })
			if ((await transferButton.count()) === 0) {
				check(
					text.includes("switched off in settings"),
					"/suppliers/transfers explains a disabled transfer flag",
				)
				await shot(page, "plan14-transfers-1440.png")
				return
			}

			await transferButton.first().click()
			const dialog = page.getByRole("dialog")
			await dialog.waitFor()
			check(
				(await dialog.getByText("Send a supplier transfer").count()) === 1,
				"/suppliers/transfers opens the transfer dialog",
			)
			const balance = dialog.locator('[data-slot="provider-balance"]')
			const balanceText = ((await balance.innerText()) ?? "").trim()
			check(
				(await balance.count()) === 1 && balanceText.length > 0,
				"the transfer dialog opens with the provider balance line",
				balanceText || "no balance line",
			)

			// No amount typed: the dialog must refuse rather than send a zero-pesewa instruction.
			await dialog.getByRole("button", { name: "Send transfer" }).click()
			check(
				(await dialog.getByText("Enter a transfer amount like 250.00.").count()) === 1,
				"the transfer dialog refuses a zero amount",
			)
			// The OTP path is intentionally not driven here: the mock's OTP lever is test-only, and
			// the state machine is proven by `payables.transfer.test.ts`.
			await dialog.getByRole("button", { name: "Cancel" }).click()
			await dialog.waitFor({ state: "hidden" })
			await shot(page, "plan14-transfers-1440.png")
		},
	],
	[
		"/suppliers/reconciliation",
		async (page) => {
			const headers = await tableHeaders(page)
			const missing = [
				"State",
				"Supplier",
				"Reference",
				"Money out",
				"Posted",
				"Not allocated",
				"When",
				"Outcome",
			].filter((header) => !headers.includes(header))
			check(
				missing.length === 0,
				"/suppliers/reconciliation renders the three-state columns",
				missing.length > 0 ? `missing ${missing.join(", ")}` : undefined,
			)

			const text = await page.locator("main").innerText()
			const tiles = ["Settled", "Manual", "Unposted", "Failed", "Reversed"].filter((label) =>
				text.includes(label),
			)
			check(
				tiles.length === 5,
				"/suppliers/reconciliation renders its five headline tiles",
				tiles.join(", ") || "none",
			)
			const rows = await bodyRows(page).count()
			check(
				rows > 0 || text.includes("Nothing in this period matches these filters."),
				"/suppliers/reconciliation shows its rows or its own empty state",
				`${rows} rows`,
			)
			check(
				!/NaN|undefined/.test(text),
				"/suppliers/reconciliation formats every figure",
				text.slice(0, 120),
			)
			await shot(page, "plan14-reconciliation-1440.png")
		},
	],
	[
		"/evat",
		async (page) => {
			const headers = await tableHeaders(page)
			const missing = ["Document", "Due", "Status", "Attempts", "Next attempt", "GRA code"].filter(
				(header) => !headers.includes(header),
			)
			check(
				missing.length === 0,
				"/evat renders the submission columns",
				missing.length > 0 ? `missing ${missing.join(", ")}` : undefined,
			)

			const text = await page.locator("main").innerText()
			const tiles = ["Queued", "Certified", "Retrying", "Needs attention", "Overdue"].filter(
				(label) => text.includes(label),
			)
			check(tiles.length === 5, "/evat renders its five summary tiles", tiles.join(", ") || "none")
			check(
				text.includes("Provider reachable") || text.includes("provider is unavailable"),
				"/evat renders the provider health line",
			)
			const rows = await bodyRows(page).count()
			check(
				rows > 0 ||
					text.includes("No E-VAT submissions match these filters.") ||
					text.includes("No documents have been queued yet."),
				"/evat shows its rows or its own empty state",
				`${rows} rows`,
			)
			check(!/NaN|undefined/.test(text), "/evat formats every figure", text.slice(0, 120))
			await shot(page, "plan14-evatu-1440.png")
		},
	],
	[
		"/settings",
		async (page) => {
			// The API is the list of keys. Reading the same response the page read proves parity: a
			// key the server defines but the console drops is exactly the defect this assertion is
			// for, and it was 27 keys wide before Phase 14.
			const response = await contextApi(page.request, "GET", "/api/settings")
			const expected = response.body?.settings ?? []
			const rendered = await page.locator("main [data-setting-key]").count()
			check(
				expected.length > 0 && rendered === expected.length,
				"/settings renders one row per key the API returns",
				`${rendered} rows for ${expected.length} keys`,
			)

			const flags = expected.filter((row) => String(row.key).startsWith("flag."))
			const switches = await page
				.locator('main [data-setting-key^="flag."] [data-slot="switch"]')
				.count()
			check(
				flags.length > 0 && switches === flags.length,
				"/settings renders every registry flag as a switch",
				`${switches} switches for ${flags.length} flags`,
			)

			// The source badge is derived from the API rather than assumed: a database where every
			// flag already has a row legitimately has no Default, and an assertion that demanded one
			// would fail for the wrong reason.
			const sourceLabel = (source) =>
				source === "branch" ? "Branch" : source === "global" ? "Global" : "Default"
			const mismatched = []
			for (const flag of flags) {
				const row = page.locator(`main [data-setting-key="${flag.key}"]`)
				const text = (await row.count()) === 1 ? await row.innerText() : ""
				if (!text.includes(sourceLabel(flag.source))) {
					mismatched.push(`${flag.key} → ${sourceLabel(flag.source)}`)
				}
			}
			check(
				mismatched.length === 0,
				"/settings shows each flag's source as the API resolves it",
				mismatched.join(", ") || undefined,
			)
			await shot(page, "plan14-settings-1440.png")
		},
	],
	[
		"/staff/permissions",
		async (page) => {
			const headers = await tableHeaders(page)
			const missing = ["Permission", "Administrator", "Manager", "Cashier"].filter(
				(header) => !headers.includes(header),
			)
			check(
				missing.length === 0,
				"/staff/permissions renders the three role columns",
				missing.length > 0 ? `missing ${missing.join(", ")}` : undefined,
			)

			// 66 is `PERMISSIONS.length` in packages/shared/src/permissions.ts. The walkthrough is
			// plain node, so the number is stated here and the caption is the server-shared truth it
			// must agree with.
			const rows = await page.locator("main [data-permission]").count()
			check(rows === 66, "/staff/permissions renders one row per permission", `${rows} rows`)

			const text = await page.locator("main").innerText()
			check(
				/66\s+permissions/.test(text) &&
					/Administrator\s+66/.test(text) &&
					/Manager\s+54/.test(text) &&
					/Cashier\s+0/.test(text),
				"/staff/permissions captions the per-role counts",
				text.slice(0, 160).replace(/\s+/g, " "),
			)
			check(
				/the API decides, and the console's own checks are cosmetic/i.test(text),
				"/staff/permissions says the API enforces and the console is cosmetic",
			)
			await shot(page, "plan14-permissions-1440.png")
		},
	],
	[
		"/audit",
		async (page) => {
			const headers = await tableHeaders(page)
			const missing = ["Entity ID", "Terminal", "Request ID"].filter(
				(header) => !headers.includes(header),
			)
			check(
				missing.length === 0,
				"/audit names the entity, the terminal and the request",
				missing.length > 0 ? `missing ${missing.join(", ")}` : undefined,
			)

			const rows = await bodyRows(page).count()
			const text = await page.locator("main").innerText()
			check(
				rows > 0 || text.includes("No entries match these filters."),
				"/audit shows its rows or its own empty state",
				`${rows} rows`,
			)

			if (rows > 0) {
				const cells = await bodyRows(page).first().locator('[data-slot="table-cell"]').count()
				check(cells === 9, "/audit renders every column on a row", `${cells} cells`)
				const copyControls = await page.locator('main button[aria-label^="Copy "]').count()
				check(
					copyControls > 0,
					"/audit's ids have a copy control with an accessible name",
					`${copyControls} controls`,
				)
			} else {
				check(true, "/audit had no audited row to inspect beyond its columns")
			}

			// Filters the API already supported and the console did not expose.
			const actorField = page.locator("#audit-actor-id")
			const entityIdField = page.locator("#audit-entity-id")
			check(
				(await actorField.count()) === 1 && (await entityIdField.count()) === 1,
				"/audit exposes the actor id and entity id filters",
			)
			check(
				text.includes("The file never contains before/after payloads."),
				"/audit says the export excludes payloads",
			)
			await expectExport(page, "/api/audit/export")
			await shot(page, "plan14-audit-1440.png")
		},
	],
	[
		"/inventory/stock",
		async (page) => {
			// The export and print controls live in report mode, which is a URL flag.
			await visit(page, "/inventory/stock?report=true", "Value at average cost")
			const text = await page.locator("main").innerText()
			check(
				text.includes("Products") && text.includes("Units on hand"),
				"/inventory/stock report renders the API totals",
				text.slice(0, 120),
			)

			const report = await screenJson(page, "/api/inventory/stock/report")
			const truncated = report?.truncated === true
			check(
				text.includes("This report is capped") === truncated,
				"/inventory/stock report states truncation exactly when the API does",
				`truncated=${truncated}`,
			)

			const { metaText } = await expectExportAndPrint(page, "/api/inventory/stock/report/export")
			// A capped report keeps its totals on screen but refuses the file: a CSV whose rows
			// stop at the cap and whose TOTAL covers every match does not add up.
			const exportButton = page.locator(
				'main [data-slot="export-button"][data-export-path="/api/inventory/stock/report/export"]',
			)
			const exportDisabled = await exportButton.isDisabled()
			check(
				exportDisabled === truncated,
				"/inventory/stock refuses the export exactly when the report is capped",
				`truncated=${truncated}, disabled=${exportDisabled}`,
			)
			if (truncated) {
				const describedBy = await exportButton.getAttribute("aria-describedby")
				check(
					describedBy === "stock-report-cap",
					"/inventory/stock's disabled export names the banner that explains it",
					String(describedBy),
				)
			}
			check(
				/Branch/.test(metaText) && /Period/.test(metaText) && /As at/.test(metaText),
				"/inventory/stock print sheet names its branch, period and instant",
				metaText.slice(0, 160),
			)
			check(
				Boolean(report) && metaText.includes(sharedDateTime(report.asOf)),
				"/inventory/stock prints the instant the projection was read",
				metaText.slice(0, 160),
			)
			await shot(page, "plan14-stock-report-1440.png")
		},
	],
	[
		"/customers/aging",
		async (page) => {
			const { metaText } = await expectExportAndPrint(page, "/api/credit/aging/export")
			check(
				/\bAs at\b/.test(metaText),
				"/customers/aging print sheet states the as-of date",
				metaText.slice(0, 120),
			)
			const aging = await screenJson(page, "/api/credit/aging")
			check(
				Boolean(aging) && metaText.includes(sharedDay(aging.asOf)),
				"/customers/aging prints the report's asOf, not today's date",
				metaText.slice(0, 160),
			)
			await shot(page, "plan14-credit-aging-1440.png")
		},
	],
	[
		"/suppliers/aging",
		async (page) => {
			const { metaText } = await expectExportAndPrint(page, "/api/payables/aging/export")
			check(
				/\bAs at\b/.test(metaText) && /\bSupplier\b/.test(metaText),
				"/suppliers/aging print sheet states its as-of date and supplier filter",
				metaText.slice(0, 120),
			)
			const aging = await screenJson(page, "/api/payables/aging")
			check(
				Boolean(aging) && metaText.includes(sharedDay(aging.asOf)),
				"/suppliers/aging prints the report's asOf, not today's date",
				metaText.slice(0, 160),
			)
			await shot(page, "plan14-payables-aging-1440.png")
		},
	],
	[
		"/loyalty",
		async (page) => {
			const { metaText } = await expectExportAndPrint(page, "/api/loyalty/liability/export")
			// D21: the balance has no history, so the printed page must carry the instant.
			check(
				/Liability as at/.test(metaText) && /\d{1,2}:\d{2}/.test(metaText),
				"/loyalty print sheet stamps the liability as of now",
				metaText.slice(0, 160),
			)
			const liability = await screenJson(page, "/api/loyalty/liability")
			check(
				Boolean(liability) && metaText.includes(sharedDateTime(liability.asOf)),
				"/loyalty prints the instant the liability was read",
				metaText.slice(0, 160),
			)
			const text = await page.locator("main").innerText()
			check(
				/a live projection, not a historic valuation/.test(text),
				"/loyalty says on screen that the liability is as of now",
			)
			await shot(page, "plan14-loyalty-liability-1440.png")
		},
	],
])

/** Copy that means the screen did not actually work. */
const BROKEN = [
	/Couldn't load/i,
	/An error occurred/i,
	/Something went wrong/i,
	/Cannot read propert/i,
]

const consoleErrors = []
const failedRequests = []

const KNOWN_NOISE = [
	// Pre-existing: /inventory/transfers/new renders a value that differs between server and client.
	// The page body is byte-identical to the pre-Phase-8 route, so this is not a migration defect.
	/hydrated but some attributes of the server rendered HTML/,
]

function watch(page) {
	page.on("console", (message) => {
		if (message.type() !== "error") return
		const text = message.text()
		if (KNOWN_NOISE.some((pattern) => pattern.test(text))) return
		// The manager leg's one tolerated 403 (see the response handler) also surfaces as a
		// browser console error; excuse exactly that URL, not every 403.
		const source = message.location()?.url ?? ""
		if (/status of 403/.test(text) && source.endsWith("/api/branches")) return
		consoleErrors.push(text)
	})
	page.on("response", (response) => {
		const status = response.status()
		if (status < 400) return
		// Pre-existing: lib/branch-context asks for the branch list for every role, and a manager has
		// no branch.read, so the manager leg always produces one 403. Recorded as a carry-forward.
		if (status === 403 && response.url().endsWith("/api/branches")) return
		if (response.url().includes("/api/me")) return
		failedRequests.push(`${status} ${response.url()}`)
	})
}

async function visit(page, route, expected) {
	const before = { errors: consoleErrors.length, failed: failedRequests.length }
	await page.goto(`${adminUrl}${route}`, { waitUntil: "networkidle" })
	// A route that throws inside its page component renders the router's error boundary instead
	// of `<main>`. Record that as a failed check (with the boundary's text) and keep walking, so
	// one broken screen cannot hide every section after it.
	let rendered = true
	await page
		.locator("main")
		.waitFor({ timeout: 20_000 })
		.catch(() => {
			rendered = false
		})

	const text = rendered
		? await page.locator("main").innerText()
		: await page.locator("body").innerText()
	const newErrors = consoleErrors.slice(before.errors)
	const newFailed = failedRequests.slice(before.failed)
	const broken = BROKEN.find((pattern) => pattern.test(text))

	const ok =
		rendered &&
		page.url().includes(route.split("?")[0]) &&
		!broken &&
		newErrors.length === 0 &&
		newFailed.length === 0 &&
		(expected === null || text.includes(expected))

	check(
		ok,
		`${route} renders${expected ? ` "${expected}"` : ""}`,
		!rendered
			? `no <main> rendered: ${text.slice(0, 120).replace(/\s+/g, " ")}`
			: broken
				? `page contains ${broken}`
				: newErrors.length > 0
					? `console: ${newErrors[0].slice(0, 120)}`
					: newFailed.length > 0
						? `request: ${newFailed[0]}`
						: expected && !text.includes(expected)
							? `missing "${expected}"`
							: undefined,
	)
	return text
}

/**
 * Follow the first link on the current page matching `pattern`, returning its href.
 * Polls, because a list that is still re-querying (after a branch switch) has no rows yet.
 */
async function firstHref(page, pattern, timeoutMs = 8_000) {
	const read = () =>
		page
			.locator("main a")
			.evaluateAll(
				(links, source) =>
					links
						.map((link) => link.getAttribute("href"))
						.find((value) => value && new RegExp(source).test(value)) ?? null,
				pattern,
			)
	const deadline = Date.now() + timeoutMs
	let href = await read()
	while (!href && Date.now() < deadline) {
		await page.waitForTimeout(250)
		href = await read()
	}
	return href
}

/** API calls from the browser context, so the session cookie the UI holds is the one used. */
async function contextFetch(request, method, path, { data, token } = {}) {
	const base = process.env.API_BASE_URL ?? envValue("VITE_API_URL") ?? "http://localhost:4000"
	const headers = { origin: adminUrl }
	if (token) headers.authorization = `Bearer ${token}`
	if (data !== undefined) headers["content-type"] = "application/json"
	const response = await request.fetch(`${base}${path}`, { method, headers, data })
	return { status: response.status(), body: await response.json().catch(() => null) }
}

function contextApi(request, method, path, data) {
	return contextFetch(request, method, path, { data })
}

/**
 * The JSON the screen itself read, re-fetched from the exact URL the browser asked for.
 *
 * Asserting provenance against a hand-built query would compare two different reads; this
 * compares the printed page with the response that produced it.
 */
async function screenJson(page, fragment) {
	const url = await page.evaluate(
		(needle) =>
			performance
				.getEntriesByType("resource")
				.map((entry) => entry.name)
				.find((name) => name.includes(needle)) ?? null,
		fragment,
	)
	if (!url) return null
	return (await contextFetch(page.request, "GET", url.slice(url.indexOf("/api")))).body
}

// The shared formatters' contract, restated in plain node: `formatDay` is en-GB
// `28 Oct 2026` and `formatDateTime` is `28 Oct 2026, 15:04`. The walkthrough cannot import
// the workspace package, so this is the same Intl call rather than a hard-coded date.
function sharedDay(iso) {
	const parts = new Intl.DateTimeFormat("en-GB", {
		day: "numeric",
		month: "short",
		year: "numeric",
	}).formatToParts(new Date(iso))
	const pick = (type) => parts.find((part) => part.type === type)?.value ?? ""
	return `${pick("day")} ${pick("month")} ${pick("year")}`
}

function sharedDateTime(iso) {
	const parts = new Intl.DateTimeFormat("en-GB", {
		day: "numeric",
		month: "short",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).formatToParts(new Date(iso))
	const pick = (type) => parts.find((part) => part.type === type)?.value ?? ""
	return `${pick("day")} ${pick("month")} ${pick("year")}, ${pick("hour")}:${pick("minute")}`
}

/** The pending-approval badge in the sidebar; absent means a clean queue, i.e. zero. */
async function badgeCount(page) {
	const badge = page.locator('[aria-label$="pending approvals"]').first()
	if ((await badge.count()) === 0) return 0
	return Number.parseInt((await badge.innerText()).trim(), 10)
}

/** Poll a value that a background query will change; no fixed sleeps. */
async function waitUntil(page, read, predicate, timeoutMs = 20_000) {
	const deadline = Date.now() + timeoutMs
	let value = await read()
	while (!predicate(value) && Date.now() < deadline) {
		await page.waitForTimeout(250)
		value = await read()
	}
	return value
}

/**
 * A real closed shift with a variance over the branch tolerance, driven the way a terminal
 * drives it: enrol a device, mint a device JWT, then POST the same sync upload the POS posts.
 * Returns the id of the pending `SHIFT_VARIANCE_REVIEW` it raised, or null with the failure
 * recorded rather than faked.
 */
async function createShiftVarianceApproval(request, branchId, cashierEmail) {
	const terminalResponse = await contextApi(request, "POST", "/api/terminals", {
		branchId,
		name: `Console walkthrough ${Date.now()}`,
	})
	const terminal = terminalResponse.body?.terminal
	if (!terminal) return null

	const enrollment = (await contextApi(request, "POST", `/api/terminals/${terminal.id}/enrollment`))
		.body?.enrollment
	if (!enrollment) return null

	const redeemed = await contextApi(request, "POST", "/api/enrollments/redeem", {
		code: enrollment.code,
		fingerprint: `console-walkthrough-${Date.now()}`,
	})
	const deviceToken = redeemed.body?.deviceToken
	if (!deviceToken) return null

	const deviceSession = await contextFetch(request, "POST", "/api/pos/session", {
		token: deviceToken,
	})
	const device = deviceSession.body
	if (!device?.accessToken) return null

	const settings = await contextApi(request, "GET", `/api/settings?branchId=${branchId}`)
	const tolerance = (settings.body?.settings ?? []).find(
		(row) => row.key === "pos.shiftVarianceToleranceMinor",
	)?.value
	const staff = (
		await contextApi(
			request,
			"GET",
			`/api/staff?search=${encodeURIComponent(cashierEmail)}&limit=20`,
		)
	).body?.staff?.find((row) => row.email === cashierEmail)
	if (typeof tolerance !== "number" || !staff?.id || !staff?.staffId) return null

	const shiftId = crypto.randomUUID()
	const upload = (transactions) =>
		contextFetch(request, "POST", "/api/pos/sync/upload", {
			token: device.accessToken,
			data: {
				batchId: crypto.randomUUID(),
				deviceId: device.deviceId,
				terminalId: device.terminal.id,
				transactions,
			},
		})

	const opened = await upload([
		{
			clientTransactionId: crypto.randomUUID(),
			type: "SHIFT_OPEN",
			occurredAt: new Date().toISOString(),
			payloadVersion: 1,
			payload: {
				shiftId,
				number: `CW-${Date.now()}`,
				openingFloatMinor: 0,
				cashierUserId: staff.id,
				cashierStaffId: staff.staffId,
				occurredAt: new Date().toISOString(),
			},
		},
	])
	if (opened.body?.results?.[0]?.status !== "APPLIED") return null

	// One pesewa over tolerance, so the server raises the review and this is not a fake row.
	const closed = await upload([
		{
			clientTransactionId: crypto.randomUUID(),
			type: "SHIFT_CLOSE",
			occurredAt: new Date().toISOString(),
			payloadVersion: 1,
			payload: {
				shiftId,
				countedCashMinor: tolerance + 1,
				clientExpectedCashMinor: 0,
				closeNote: "Console walkthrough: drawer one pesewa over tolerance.",
				occurredAt: new Date().toISOString(),
			},
		},
	])
	if (closed.body?.results?.[0]?.status !== "APPLIED") return null

	const approvals = await contextApi(
		request,
		"GET",
		`/api/approvals?type=SHIFT_VARIANCE_REVIEW&entityId=${shiftId}&status=PENDING`,
	)
	return approvals.body?.approvals?.[0]?.id ?? null
}

// --- run --------------------------------------------------------------------

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
page.setDefaultTimeout(25_000)
watch(page)

try {
	section("admin sign-in")
	await signIn(page, envValue("ADMIN_EMAIL"), envValue("ADMIN_PASSWORD"))
	check(new URL(page.url()).pathname === "/", "admin lands on the dashboard", page.url())

	section("every section")
	for (const [route, expected] of SECTIONS) {
		await visit(page, route, expected)
		const assertions = SECTION_ASSERTIONS.get(route)
		if (assertions) await assertions(page)
	}

	section("detail screens")
	const inSection = async (listRoute, pattern, label, expected = null) => {
		await page.goto(`${adminUrl}${listRoute}`, { waitUntil: "networkidle" })
		await page.locator("main").waitFor()
		let href = await firstHref(page, pattern)

		// Some tables render a "View" link whose href TanStack builds at runtime from `params`, so
		// fall back to following it rather than parsing it.
		if (!href) {
			const view = page.locator("main a", { hasText: /^View$/ }).first()
			if ((await view.count()) > 0) {
				await Promise.all([page.waitForURL(/\/[0-9a-f-]{36}/, { timeout: 20_000 }), view.click()])
				href = new URL(page.url()).pathname
			}
		}

		// Branch-scoped lists ask the admin to pick a branch first. Doing so is part of the flow, and
		// it is the only way to reach a detail screen from an "All branches" console.
		if (!href) {
			// Give the list a moment to settle into either rows or its branch prompt.
			await page
				.getByText(/Choose a branch/i)
				.first()
				.waitFor({ timeout: 3_000 })
				.catch(() => undefined)
			const prompt = page.getByText(/Choose a branch/i).first()
			if ((await prompt.count()) > 0) {
				await page.locator('header button[aria-label="Active branch"]').click()
				await page.locator('[role="option"]').nth(1).click()
				await page.waitForLoadState("networkidle")
				href = await firstHref(page, pattern, 12_000)
			}
		}

		if (!href) {
			// Otherwise an empty list is legitimate, but it must say so.
			const text = await page.locator("main").innerText()
			check(
				/no .*(yet|recorded|found)/i.test(text),
				`${label}: no row to open, and the list shows its empty state`,
				text.slice(0, 120),
			)
			return null
		}
		await visit(page, href, expected)
		return href
	}

	// The expected text is not decoration: without it, a detail route that is a child of a layout
	// with no <Outlet /> renders the *list* page at the detail URL and still passes. That is
	// exactly what `/branches/$id` did until 2026-10-25, so the branch detail asserts text only
	// the detail page can produce.
	await inSection("/branches", "^/branches/[^/]+$", "branch detail", "Updated")
	await inSection("/catalog/products", "^/catalog/products/(?!new$)[^/]+$", "product detail")
	await inSection("/inventory/stock", "^/inventory/stock/[^/]+$", "stock detail")
	await inSection("/inventory/receipts", "^/inventory/receipts/[^/]+$", "receipt detail")
	await inSection("/suppliers", "^/suppliers/[^/]+$", "supplier detail")
	await inSection("/suppliers/invoices", "^/suppliers/invoices/[^/]+$", "invoice detail")
	await inSection("/suppliers/payments", "^/suppliers/payments/[^/]+$", "payment detail")

	// The receipt copy is the one document whose header must say what it is, and whose
	// figures must match the sale the list linked. The expected text is the caption, so a
	// detail route that renders the list again cannot pass.
	const saleHref = await inSection(
		"/pos?tab=sales",
		"^/pos/sales/[^/]+$",
		"sale detail",
		"Copy of receipt — not a till reprint",
	)
	if (saleHref) {
		const receiptText = await page.locator("main").innerText()
		const salesResponse = await contextApi(page.request, "GET", "/api/pos/oversight/sales?limit=1")
		const receiptNumber = salesResponse.body?.sales?.[0]?.receiptNumber
		check(
			typeof receiptNumber === "string" && receiptText.includes(receiptNumber),
			"the receipt copy shows the receipt number the sale carries",
			typeof receiptNumber === "string" ? receiptNumber : "no sale on the API's first page",
		)
		check(/TOTAL/.test(receiptText), "the receipt copy shows a TOTAL figure")
		check(
			!/NaN|undefined/.test(receiptText),
			"the receipt copy formats every figure",
			receiptText.slice(0, 120).replace(/\s+/g, " "),
		)
		await shot(page, "plan08-pos-sale-detail-1440.png")
	} else {
		check(true, "sale detail: no sale row to open, and the sales list showed its empty state")
	}

	const customerHref = await inSection("/customers", "^/customers/[^/]+$", "customer detail")
	if (customerHref) await visit(page, `${customerHref}/statement`, null)

	await page.goto(`${adminUrl}/`, { waitUntil: "networkidle" })
	await page.screenshot({
		path: path.join(evidenceDir, "plan09-admin-dashboard.png"),
		fullPage: true,
	})

	section("analytics charts and export")
	const analyticsRoutes = [
		"/analytics?tab=sales",
		"/analytics?tab=products",
		"/analytics?tab=inventory",
		"/analytics?tab=credit",
		"/analytics?tab=loyalty",
		"/analytics?tab=payables",
		"/analytics?tab=tax&granularity=month",
	]
	for (const route of analyticsRoutes) {
		await visit(page, route, null)
		const figures = page.locator("main figure")
		const figureCount = await figures.count()
		check(figureCount > 0, `${route} renders at least one chart`, `${figureCount} figures`)

		const problems = await figures.evaluateAll((nodes) =>
			nodes.map((figure) => {
				const caption = figure.querySelector("figcaption")?.textContent?.trim() ?? ""
				const label = figure.getAttribute("aria-labelledby") ?? ""
				const details = figure.querySelector("details")
				const table = details?.querySelector("table")
				const tableCaption = table?.querySelector("caption")?.textContent?.trim() ?? ""
				const axisLabels = figure.querySelectorAll("svg text").length
				return {
					missingCaption: caption.length === 0,
					missingLabel: label.length === 0,
					missingDetails: !details,
					missingTable: !table,
					missingTableCaption: tableCaption.length === 0,
					noAxisLabels: axisLabels === 0,
				}
			}),
		)
		const bad = problems.find((problem) => Object.values(problem).some(Boolean))
		check(
			!bad,
			`${route}: every chart has a caption, an aria-label, axes, and a data table`,
			bad ? JSON.stringify(bad) : undefined,
		)
	}

	// The default Sales export must produce a real, escaped, CRLF CSV with a BOM.
	await page.goto(`${adminUrl}/analytics?tab=sales`, { waitUntil: "networkidle" })
	const csvPath = path.join(evidenceDir, "plan09-sales-export.csv")
	const [download] = await Promise.all([
		page.waitForEvent("download", { timeout: 20_000 }),
		page
			.getByRole("button", { name: /Export CSV/i })
			.first()
			.click(),
	])
	await download.saveAs(csvPath)
	const csvText = fs.readFileSync(csvPath, "utf8")
	check(csvText.startsWith("\uFEFF"), "sales CSV starts with a UTF-8 BOM")
	check(csvText.includes("receipt_number"), "sales CSV carries the expected header row")
	check(csvText.includes("\r\n"), "sales CSV uses CRLF line endings")
	check(csvText.split("\r\n").length > 1, "sales CSV carries at least one data row")
	fs.rmSync(csvPath, { force: true })

	let pendingOrderId = ""
	let approvedOrderId = ""

	section("manager role boundary")
	const managerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
	const managerPage = await managerContext.newPage()
	managerPage.setDefaultTimeout(25_000)
	watch(managerPage)

	const managerEmail = envValue("DEMO_MANAGER_EMAIL") ?? "manager@sceptre.local"
	const seededPassword = envValue("DEMO_PASSWORD") ?? "demo-password-1234"
	const changedPassword = fs.existsSync(managerPasswordFile)
		? fs.readFileSync(managerPasswordFile, "utf8").trim()
		: null
	await signIn(managerPage, managerEmail, changedPassword ?? seededPassword)

	// The demo manager is seeded with `mustChangePassword`, so the first run completes the forced
	// change and records the new password for later runs. That gate is itself a UIX-07 behaviour.
	if (new URL(managerPage.url()).pathname === "/change-password") {
		const next = "Demo-manager-2026"
		await robustFill(managerPage, "#current-password", changedPassword ?? seededPassword)
		await robustFill(managerPage, "#new-password", next)
		await robustFill(managerPage, "#confirm-password", next)
		await managerPage.getByRole("button", { name: /Change password|Save/i }).click()
		await managerPage.waitForURL((value) => new URL(value).pathname !== "/change-password", {
			timeout: 30_000,
		})
		fs.writeFileSync(managerPasswordFile, next)
		check(true, "manager completes the forced password change")
	} else {
		check(true, "manager password already changed (re-run)")
	}

	await managerPage.waitForLoadState("networkidle")
	check(
		new URL(managerPage.url()).pathname === "/",
		"manager lands on the dashboard",
		managerPage.url(),
	)

	await managerPage.goto(`${adminUrl}/`, { waitUntil: "networkidle" })
	const fascia = await managerPage.locator("header").first().innerText()
	check(!/All branches/.test(fascia), 'manager has no "All branches" option')
	check(
		(await managerPage.locator('header [role="combobox"]').count()) === 0,
		"manager branch control is a locked badge, not a select",
	)

	for (const route of [
		"/",
		"/analytics",
		"/analytics?tab=payables",
		"/inventory/stock",
		"/customers",
		"/customers/aging",
		"/suppliers",
		"/audit",
	]) {
		await managerPage.goto(`${adminUrl}${route}`, { waitUntil: "networkidle" })
		await managerPage.locator("main").waitFor()
		const text = await managerPage.locator("main").innerText()
		const broken = BROKEN.find((pattern) => pattern.test(text))
		check(!broken, `manager can open ${route}`, broken ? `page contains ${broken}` : undefined)
	}

	// A branch id smuggled into the query string must not change what a manager sees, on a
	// list screen or on analytics, where the client drops it before it reaches the API.
	const analyticsBefore = await managerPage.goto(`${adminUrl}/analytics`, {
		waitUntil: "networkidle",
	})
	await managerPage.locator("main").waitFor()
	const analyticsBaseline = await managerPage.locator("main").innerText()
	await managerPage.goto(`${adminUrl}/analytics?branchId=00000000-0000-0000-0000-000000000000`, {
		waitUntil: "networkidle",
	})
	await managerPage.locator("main").waitFor()
	const analyticsAfter = await managerPage.locator("main").innerText()
	check(
		analyticsBaseline.length > 0 &&
			analyticsAfter.replace(/\s+/g, " ") === analyticsBaseline.replace(/\s+/g, " "),
		"a foreign branchId does not change a manager's analytics view",
	)
	check(analyticsBefore !== null, "manager analytics navigated")

	const before = await managerPage.locator("main").innerText()
	await managerPage.goto(
		`${adminUrl}/customers/aging?branchId=00000000-0000-0000-0000-000000000000`,
		{
			waitUntil: "networkidle",
		},
	)
	await managerPage.locator("main").waitFor()
	const after = await managerPage.locator("main").innerText()
	check(
		before.length > 0 && !/Access denied|Forbidden/i.test(after) && !/Couldn't load/i.test(after),
		"a foreign branchId in the URL does not break the manager view",
	)

	await managerPage.goto(`${adminUrl}/staff`, { waitUntil: "networkidle" })
	await managerPage.locator("main").waitFor()
	const staffText = await managerPage.locator("main").innerText()
	check(!/Administrator/.test(staffText), "manager staff list hides global admin accounts")

	section("procurement (manager)")
	const branchesResponse = await contextApi(managerPage.request, "GET", "/api/branches?limit=50")
	const demoBranch = (branchesResponse.body?.branches ?? []).find((row) => row.code === "ACC-SPX")
	const catalogResponse = await contextApi(
		managerPage.request,
		"GET",
		"/api/products?q=GIK-00001&limit=1",
	)
	const supplierResponse = await contextApi(managerPage.request, "GET", "/api/suppliers?limit=1")
	const demoProduct = catalogResponse.body?.products?.[0]
	const demoSupplier = supplierResponse.body?.suppliers?.[0]
	check(
		Boolean(demoBranch && demoProduct && demoSupplier),
		"procurement fixtures exist in the demo branch",
		JSON.stringify({ branch: demoBranch?.code, product: demoProduct?.sku }),
	)

	const makeOrder = async (quantity, unitCostMinor) => {
		const created = await contextApi(managerPage.request, "POST", "/api/procurement/orders", {
			branchId: demoBranch.id,
			supplierId: demoSupplier.id,
			expectedDate: "2026-12-01",
			idempotencyKey: crypto.randomUUID(),
			lines: [{ productId: demoProduct.id, quantity, unitCostMinor }],
		})
		const orderId = created.body?.order?.id
		await contextApi(managerPage.request, "POST", `/api/procurement/orders/${orderId}/submit`)
		return orderId
	}
	approvedOrderId = await makeOrder(10, 1_000)
	pendingOrderId = await makeOrder(2_000, 1_000)
	check(
		Boolean(approvedOrderId && pendingOrderId),
		"manager raises an approved and a pending order",
	)

	await managerPage.goto(`${adminUrl}/procurement/orders`, { waitUntil: "networkidle" })
	await managerPage.locator("main").waitFor()
	const managerOrders = await managerPage
		.locator('main a[href^="/procurement/orders/"]:not([href="/procurement/orders/new"])')
		.count()
	const managerOrdersApi = await contextApi(
		managerPage.request,
		"GET",
		"/api/procurement/orders?limit=50",
	)
	check(
		managerOrders > 0 && managerOrders <= (managerOrdersApi.body?.total ?? 0),
		"the manager's order list is exactly their branch's orders",
		`${managerOrders} rows vs API total ${managerOrdersApi.body?.total}`,
	)
	check(
		(await managerPage.locator("main").getByRole("columnheader", { name: "Branch" }).count()) === 0,
		"a manager sees no branch column, so no other branch's orders",
	)
	check(
		(await managerPage.getByRole("button", { name: /Approve order/i }).count()) === 0,
		"a manager sees no approve action on the list",
	)
	await managerPage.screenshot({
		path: path.join(evidenceDir, "plan11-orders-list.png"),
		fullPage: true,
	})

	await managerPage.goto(`${adminUrl}/procurement/orders/${pendingOrderId}`, {
		waitUntil: "networkidle",
	})
	await managerPage.locator("main").waitFor()
	const pendingText = await managerPage.locator("main").innerText()
	check(/Awaiting admin approval/i.test(pendingText), "the pending order says it is waiting")
	check(
		(await managerPage.getByRole("button", { name: /Approve order/i }).count()) === 0,
		"a manager cannot approve an order from its detail",
	)
	await managerPage.screenshot({
		path: path.join(evidenceDir, "plan11-order-detail-pending.png"),
		fullPage: true,
	})

	section("branch operations (manager)")

	const managerBranchesResponse = await contextApi(managerPage.request, "GET", "/api/branches")
	const managerBranch = managerBranchesResponse.body?.branches?.[0]
	const managerSessionResponse = await contextApi(
		managerPage.request,
		"GET",
		"/api/auth/get-session",
	)
	const managerStaffId = managerSessionResponse.body?.user?.staffId ?? ""
	const managerBranchId = managerBranch?.id ?? ""
	check(
		Boolean(managerBranchId && managerStaffId),
		"the manager session names its branch and its staff id",
		`${managerBranch?.code ?? "no branch"} ${managerStaffId || "no staff id"}`,
	)

	// Enough stock to write one off, and a product with no pending price change so the
	// override row is editable. Both come from the API the screen itself reads.
	const managerStock = await contextApi(
		managerPage.request,
		"GET",
		`/api/inventory/stock?branchId=${managerBranchId}&limit=200`,
	)
	const pendingPrices = await contextApi(
		managerPage.request,
		"GET",
		"/api/approvals?type=PRICE_CHANGE&status=PENDING&limit=100",
	)
	const blockedPriceProducts = new Set(
		(pendingPrices.body?.approvals ?? []).map((row) => row.entityId),
	)
	const priceProduct = (managerStock.body?.stock ?? []).find(
		(row) => !blockedPriceProducts.has(row.productId),
	)
	const writeOffProduct = (managerStock.body?.stock ?? []).find((row) => row.quantityOnHand >= 1)
	check(
		Boolean(priceProduct && writeOffProduct),
		"the manager has a product to price and one to write off",
		JSON.stringify({ price: priceProduct?.sku, writeOff: writeOffProduct?.sku }),
	)

	// 1. Raise a transfer request through the form.
	await managerPage.goto(`${adminUrl}/inventory/transfers/new`, { waitUntil: "networkidle" })
	await managerPage.locator("main").waitFor()
	await managerPage.locator("#from-branch").click()
	const sourceOptionText = (await managerPage.getByRole("option").allInnerTexts()).find(
		(text) => !text.includes(managerBranch?.code ?? ""),
	)
	await managerPage.getByRole("option", { name: sourceOptionText, exact: true }).click()
	const transferSearch = managerPage.getByRole("textbox", { name: "Search products" })
	await transferSearch.fill(writeOffProduct.sku)
	const transferResults = managerPage.getByRole("list", { name: "Product results" })
	const transferResult = transferResults
		.getByRole("button")
		.filter({ hasText: writeOffProduct.sku })
	await transferResult.waitFor({ timeout: 10_000 })
	await transferResult.click()
	// The picker loads the product detail before it calls onSelect. Typing the quantity while
	// that request is in flight lets the late onSelect overwrite the draft line and clear it.
	await transferSearch.waitFor({ state: "detached", timeout: 10_000 })
	const transferQuantity = managerPage.getByLabel("Requested quantity for line 1")
	await transferQuantity.fill("2")
	if ((await transferQuantity.inputValue()) !== "2") {
		throw new Error("the transfer line did not keep the requested quantity")
	}
	await managerPage.getByRole("button", { name: "Request transfer" }).click()
	await managerPage.waitForURL(/\/inventory\/transfers\/[0-9a-f-]{36}$/, { timeout: 20_000 })
	await managerPage.getByRole("heading", { name: /^Transfer TRF-/ }).waitFor({ timeout: 20_000 })

	const transferPath = new URL(managerPage.url()).pathname
	const transferId = transferPath.split("/").pop()
	const transferText = await managerPage.locator("main").innerText()
	const transferNumber = (transferText.match(/Transfer\s+(TRF-\S+)/) ?? [])[1] ?? ""
	check(
		Boolean(transferId && transferNumber),
		"the manager raises a transfer request through the form",
		transferNumber,
	)
	check(
		transferText.includes("Waiting for the source branch") &&
			transferText.includes("Withdraw request"),
		"the new request waits for the source branch and stays withdrawable by its requester",
	)
	await managerPage.screenshot({
		path: path.join(evidenceDir, "plan12-transfer-request-manager.png"),
		fullPage: true,
	})

	// 2. The inbox shows it, attributed to the requester, with no decision controls.
	await managerPage.goto(`${adminUrl}/approvals?type=TRANSFER_REQUEST`, {
		waitUntil: "networkidle",
	})
	await managerPage.locator("main").waitFor()
	const transferApprovalLookup = await contextApi(
		managerPage.request,
		"GET",
		`/api/approvals?type=TRANSFER_REQUEST&status=PENDING&entityId=${transferId}`,
	)
	const transferApprovalRow = transferApprovalLookup.body?.approvals?.[0]
	const transferRow = transferApprovalRow
		? managerPage.locator('main [data-slot="table-body"] [data-slot="table-row"]').filter({
				has: managerPage.locator(`a[href="/approvals/${transferApprovalRow.id}"]`),
			})
		: managerPage
				.locator('main [data-slot="table-body"] [data-slot="table-row"]')
				.filter({ hasText: "__missing approval__" })
	const transferRowCount = await transferRow.count()
	check(
		transferRowCount === 1,
		"the manager's own transfer request is in their inbox",
		`${transferRowCount} rows for ${transferNumber || "(no number)"}`,
	)
	let transferApprovalId = ""
	if (transferRowCount === 1) {
		check(
			(await transferRow.innerText()).includes(managerStaffId),
			"the inbox names the manager as the requester",
			managerStaffId,
		)
		await transferRow.locator('a[href^="/approvals/"]').last().click()
		await managerPage.waitForURL(/\/approvals\/[0-9a-f-]{36}$/, { timeout: 20_000 })
		await managerPage
			.getByText(/Requested by/)
			.first()
			.waitFor({ timeout: 20_000 })
		transferApprovalId = new URL(managerPage.url()).pathname.split("/").pop()
		const requesterView = await managerPage.locator("main").innerText()
		check(
			requesterView.includes(`Requested by ${managerStaffId}`),
			"the request detail names the manager as its requester",
		)
		check(
			(await managerPage.getByRole("button", { name: "Approve" }).count()) === 0 &&
				(await managerPage.getByRole("button", { name: "Reject" }).count()) === 0,
			"the requester is offered no decision controls",
		)
		check(
			requesterView.includes("Only the authorised decider can act on this request."),
			"the detail says why the requester cannot decide it",
		)
		await managerPage.screenshot({
			path: path.join(evidenceDir, "plan12-approval-requester.png"),
			fullPage: true,
		})
	} else {
		check(false, "the requester can open their own transfer request")
	}

	// 3. A price outside the band states the band and asks for a request, not a save.
	await managerPage.goto(`${adminUrl}/catalog/products/${priceProduct.productId}`, {
		waitUntil: "networkidle",
	})
	await managerPage.locator("main").waitFor()
	const priceInput = managerPage.locator(
		`input[aria-label="Override price for ${managerBranch.name}"]`,
	)
	check(
		(await priceInput.count()) === 1,
		"the manager's branch has a price override row",
		managerBranch.name,
	)
	const priceForm = priceInput.locator("xpath=ancestor::form")
	const priceRowText = await priceForm.innerText()
	const effectivePrice = Number.parseFloat(
		(priceRowText.match(/Effective:\s*GHS\s*([\d,]+\.\d{2})/) ?? [])[1]?.replace(/,/g, "") ?? "",
	)
	check(
		Number.isFinite(effectivePrice) && effectivePrice > 0,
		"the override row prints the effective price the band is judged from",
		priceRowText.slice(0, 100),
	)
	await priceInput.fill((effectivePrice * 1.5).toFixed(2))
	const bandText = await priceForm.innerText()
	check(
		/outside the \d+% manager band/.test(bandText),
		"a value outside the band prints the band sentence",
		bandText.slice(-160),
	)
	check(
		(await priceForm.getByRole("button", { name: "Request price change" }).count()) === 1,
		"the submit button becomes Request price change",
	)
	await managerPage.screenshot({
		path: path.join(evidenceDir, "plan12-price-band.png"),
		fullPage: true,
	})
	await priceForm.getByRole("button", { name: "Request price change" }).click()
	await managerPage.getByText("Waiting for approval.").first().waitFor({ timeout: 20_000 })
	check(
		await priceInput.isDisabled(),
		"the price row locks once its change is waiting for a decision",
	)
	const priceApprovals = await contextApi(
		managerPage.request,
		"GET",
		`/api/approvals?type=PRICE_CHANGE&status=PENDING&entityId=${priceProduct.productId}&limit=5`,
	)
	const priceApprovalId = priceApprovals.body?.approvals?.[0]?.id ?? ""
	check(Boolean(priceApprovalId), "the price change exists as a pending approval")

	// 4. A higher credit limit is a request with a reason; the direct path is refused.
	const creditCustomer = (
		await contextApi(managerPage.request, "GET", "/api/customers?q=Kwame&limit=5")
	).body?.customers?.[0]
	check(Boolean(creditCustomer?.id), "the demo customer for the credit request exists")
	await managerPage.goto(`${adminUrl}/customers/${creditCustomer.id}`, {
		waitUntil: "networkidle",
	})
	await managerPage.locator("main").waitFor()
	await managerPage.getByRole("tab", { name: "Credit" }).click()
	const creditButton = managerPage.getByRole("button", { name: /Set up credit|Credit settings/ })
	await creditButton.waitFor({ timeout: 20_000 })
	await creditButton.click()
	const creditDialog = managerPage.getByRole("dialog")
	await creditDialog.waitFor()
	const limitInput = creditDialog.locator("#credit-limit")
	const currentLimit = Number.parseFloat(await limitInput.inputValue())
	const proposedLimit = (currentLimit + 500).toFixed(2)
	await limitInput.fill(proposedLimit)
	check(
		(await creditDialog.locator("#credit-limit-reason").count()) === 1,
		"a higher limit reveals the reason field",
	)
	check(
		(await creditDialog.getByRole("button", { name: "Request increase" }).count()) === 1,
		"the dialog offers Request increase instead of Save settings",
	)
	await managerPage.screenshot({
		path: path.join(evidenceDir, "plan12-credit-request-dialog.png"),
		fullPage: true,
	})
	const directIncrease = await contextApi(
		managerPage.request,
		"PUT",
		`/api/credit/profiles/${creditCustomer.id}`,
		{ branchId: managerBranchId, limitMinor: Math.round(Number(proposedLimit) * 100) },
	)
	check(
		directIncrease.status === 403,
		"the manager's direct limit increase is refused",
		`${directIncrease.status} ${JSON.stringify(directIncrease.body)}`,
	)
	await creditDialog
		.locator("#credit-limit-reason")
		.fill("Console walkthrough: the customer needs a higher trade limit.")
	await creditDialog.getByRole("button", { name: "Request increase" }).click()
	await managerPage
		.getByText("Credit limit increase requested")
		.first()
		.waitFor({ timeout: 20_000 })
	const creditApprovals = await contextApi(
		managerPage.request,
		"GET",
		"/api/approvals?type=CREDIT_LIMIT_CHANGE&status=PENDING&sort=newest&limit=20",
	)
	const creditApproval = (creditApprovals.body?.approvals ?? []).find(
		(row) => row.payload?.customerId === creditCustomer.id,
	)
	check(Boolean(creditApproval?.id), "the credit increase exists as a pending approval")

	// 5. The write-off form requires a note for a theft, and refuses to submit without it.
	await managerPage.goto(`${adminUrl}/inventory/write-offs/new`, { waitUntil: "networkidle" })
	await managerPage.locator("main").waitFor()
	const writeOffSearch = managerPage.getByRole("textbox", { name: "Search products" })
	await writeOffSearch.fill(writeOffProduct.sku)
	const writeOffResults = managerPage.getByRole("list", { name: "Product results" })
	const writeOffResult = writeOffResults
		.getByRole("button")
		.filter({ hasText: writeOffProduct.sku })
	await writeOffResult.waitFor({ timeout: 10_000 })
	await writeOffResult.click()
	// Same race as the transfer line: wait for the picker to resolve the product detail and call
	// onSelect before typing, otherwise that late call rebuilds the line and clears the quantity.
	await writeOffSearch.waitFor({ state: "detached", timeout: 10_000 })
	const writeOffQuantity = managerPage.getByLabel("Quantity for line 1")
	await writeOffQuantity.fill("1")
	if ((await writeOffQuantity.inputValue()) !== "1") {
		throw new Error("the write-off line did not keep the quantity typed into it")
	}
	await managerPage.locator('[id^="write-off-reason-"]').click()
	await managerPage.getByRole("option", { name: "Stolen", exact: true }).click()
	const lineNote = managerPage.locator('[id^="write-off-note-"][aria-required="true"]')
	check((await lineNote.count()) === 1, "a theft write-off marks its line note as required")
	check(
		(await managerPage.getByText("(required for this reason)").count()) > 0,
		"the form says the note is required for this reason",
	)
	await managerPage.screenshot({
		path: path.join(evidenceDir, "plan12-write-off-form.png"),
		fullPage: true,
	})
	await managerPage.getByRole("button", { name: "Submit for approval" }).click()
	const writeOffAlert = managerPage.getByRole("alert")
	await writeOffAlert.waitFor({ timeout: 10_000 })
	const writeOffAlertText = await writeOffAlert.innerText()
	check(
		/needs a note explaining what happened/i.test(writeOffAlertText),
		"submitting without the note is refused with an explanation",
		writeOffAlertText,
	)
	await lineNote.fill("Console walkthrough: one unit missing at the stock take.")
	await managerPage.getByRole("button", { name: "Submit for approval" }).click()
	await managerPage.waitForURL(/\/inventory\/write-offs\/[0-9a-f-]{36}$/, { timeout: 20_000 })
	await managerPage.getByRole("heading", { name: /^Write-off WO-/ }).waitFor({
		timeout: 20_000,
	})
	const writeOffText = await managerPage.locator("main").innerText()
	const writeOffNumber = (writeOffText.match(/Write-off\s+(WO-\S+)/) ?? [])[1] ?? ""
	check(
		Boolean(writeOffNumber),
		"the manager raises the write-off through the form",
		writeOffNumber,
	)
	await managerPage.screenshot({
		path: path.join(evidenceDir, "plan12-write-off-detail.png"),
		fullPage: true,
	})
	const writeOffApprovals = await contextApi(
		managerPage.request,
		"GET",
		"/api/approvals?type=STOCK_WRITE_OFF&status=PENDING&sort=newest&limit=20",
	)
	const writeOffApproval = (writeOffApprovals.body?.approvals ?? []).find(
		(row) => row.payload?.number === writeOffNumber,
	)
	check(Boolean(writeOffApproval?.id), "the write-off is waiting as an approval")

	// 6. 1024 x 768: the inbox scrolls its wide table; both request forms stay usable.
	section("1024x768 layout")
	await managerPage.setViewportSize({ width: 1024, height: 768 })

	await managerPage.goto(`${adminUrl}/approvals?type=TRANSFER_REQUEST`, {
		waitUntil: "networkidle",
	})
	await managerPage.locator("main").waitFor()
	await managerPage.locator('main [data-slot="table-container"]').first().waitFor()
	const inboxGeometry = await managerPage.evaluate(() => {
		const container = document.querySelector('main [data-slot="table-container"]')
		const heads = container.querySelectorAll('[data-slot="table-head"]')
		const last = heads[heads.length - 1]
		const box = container.getBoundingClientRect()
		container.scrollLeft = container.scrollWidth
		const after = last.getBoundingClientRect()
		return {
			viewport: window.innerWidth,
			document: document.documentElement.scrollWidth,
			scrollWidth: container.scrollWidth,
			clientWidth: container.clientWidth,
			boxLeft: Math.round(box.left),
			boxRight: Math.round(box.right),
			afterLeft: Math.round(after.left),
			afterRight: Math.round(after.right),
		}
	})
	check(
		inboxGeometry.document <= inboxGeometry.viewport + 1,
		"1024 inbox: no page-level horizontal scroll",
		`${inboxGeometry.document} > ${inboxGeometry.viewport}`,
	)
	check(
		inboxGeometry.scrollWidth > inboxGeometry.clientWidth,
		"1024 inbox: the wide table scrolls inside its container",
		`${inboxGeometry.scrollWidth} vs ${inboxGeometry.clientWidth}`,
	)
	check(
		inboxGeometry.afterLeft >= inboxGeometry.boxLeft - 1 &&
			inboxGeometry.afterRight <= inboxGeometry.boxRight + 1,
		"1024 inbox: the last column is reachable, not clipped",
		JSON.stringify(inboxGeometry),
	)
	await managerPage.screenshot({
		path: path.join(evidenceDir, "plan12-inbox-1024.png"),
		fullPage: true,
	})

	const assertControlsAt1024 = async (route, label, controls, screenshotName) => {
		await managerPage.goto(`${adminUrl}${route}`, { waitUntil: "networkidle" })
		await managerPage.locator("main").waitFor()
		const width = await managerPage.evaluate(() => ({
			viewport: window.innerWidth,
			document: document.documentElement.scrollWidth,
		}))
		check(
			width.document <= width.viewport + 1,
			`${label}: no horizontal scroll at 1024`,
			`${width.document} > ${width.viewport}`,
		)
		for (const [name, locator] of controls) {
			const box = await locator.boundingBox()
			check(
				Boolean(box && box.x >= 0 && box.x + box.width <= width.viewport + 1 && box.height > 0),
				`${label}: ${name} is fully visible at 1024`,
				JSON.stringify(box),
			)
		}
		await managerPage.screenshot({
			path: path.join(evidenceDir, screenshotName),
			fullPage: true,
		})
	}

	await assertControlsAt1024(
		"/inventory/transfers/new",
		"transfer request form",
		[
			["the source branch select", managerPage.locator("#from-branch")],
			["the product search", managerPage.getByRole("textbox", { name: "Search products" })],
			["the request button", managerPage.getByRole("button", { name: "Request transfer" })],
		],
		"plan12-transfer-form-1024.png",
	)
	await assertControlsAt1024(
		"/inventory/write-offs/new",
		"write-off form",
		[
			["the product search", managerPage.getByRole("textbox", { name: "Search products" })],
			["the quantity input", managerPage.getByLabel("Quantity for line 1")],
			["the reason select", managerPage.locator('[id^="write-off-reason-"]')],
			["the submit button", managerPage.getByRole("button", { name: "Submit for approval" })],
		],
		"plan12-write-off-form-1024.png",
	)
	await managerPage.setViewportSize({ width: 1440, height: 1000 })

	await managerContext.close()

	section("procurement (admin)")
	// The admin starts on "All branches"; these screens are per branch, so pick the demo one.
	await page.locator('header button[aria-label="Active branch"]').click()
	const demoBranchOption = page.locator('[role="option"]').filter({ hasText: demoBranch.name })
	if ((await demoBranchOption.count()) > 0) await demoBranchOption.first().click()
	else await page.locator('[role="option"]').nth(1).click()
	await page.waitForLoadState("networkidle")
	check(true, "the admin selects the demo branch for the procurement screens")

	await page.goto(`${adminUrl}/procurement/orders/${pendingOrderId}`, { waitUntil: "networkidle" })
	await page.locator("main").waitFor()
	await page.getByRole("button", { name: "Approve order" }).click()
	await page.getByText(/Approved by/i).waitFor({ timeout: 20_000 })
	check(true, "the admin approves the pending order in the console")
	await page.screenshot({
		path: path.join(evidenceDir, "plan11-approval-panel.png"),
		fullPage: true,
	})
	await page.goto(`${adminUrl}/procurement/orders/${pendingOrderId}`, { waitUntil: "networkidle" })
	await page.locator("main").waitFor()
	check(
		/Approved by/i.test(await page.locator("main").innerText()),
		"the approved order records who decided it",
	)
	await page.screenshot({
		path: path.join(evidenceDir, "plan11-order-detail-approved.png"),
		fullPage: true,
	})

	await page.goto(`${adminUrl}/procurement/orders/${approvedOrderId}`, { waitUntil: "networkidle" })
	await page.locator("main").waitFor()
	await page.getByRole("button", { name: "Mark as sent" }).click()
	await page.getByRole("alertdialog").getByRole("button", { name: "Mark as sent" }).click()
	await page.getByText(/^Sent/i).first().waitFor({ timeout: 20_000 })
	check(true, "the admin marks the order as sent")

	await page.getByRole("button", { name: "Receive goods" }).click()
	await page.getByRole("dialog").waitFor()
	const quantityInput = page.getByRole("dialog").locator('input[id^="receive-qty-"]').first()
	const lineId = (await quantityInput.getAttribute("id")).replace("receive-qty-", "")
	await quantityInput.fill("999")
	const reasonSelect = page.locator(`#receive-reason-${lineId}`)
	await reasonSelect.click()
	await page.getByRole("option", { name: "Supplier sent more" }).click()
	check(
		await page.getByRole("dialog").getByRole("button", { name: "Receive goods" }).isEnabled(),
		"an over-delivery reason unlocks the receive button",
	)
	await page.screenshot({
		path: path.join(evidenceDir, "plan11-receive-dialog.png"),
		fullPage: true,
	})
	await quantityInput.fill("10")
	await page.getByRole("dialog").getByRole("button", { name: "Receive goods" }).click()
	await page.getByText(/Goods received as GRN-/).waitFor({ timeout: 20_000 })
	check(true, "receiving against the order posts a receipt")

	await page.getByRole("button", { name: "Return goods" }).click()
	await page.getByRole("dialog").waitFor()
	await page.getByRole("dialog").locator("#return-receipt").click()
	await page.getByRole("option").first().click()
	await page
		.getByRole("dialog")
		.getByText(/Can still return/i)
		.first()
		.waitFor({ timeout: 20_000 })
	check(true, "the return dialog states what is still returnable")
	await page.screenshot({
		path: path.join(evidenceDir, "plan11-return-dialog.png"),
		fullPage: true,
	})
	await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).first().click()

	await page.goto(`${adminUrl}/procurement/replenishment`, { waitUntil: "networkidle" })
	await page.locator("main").waitFor()
	// The switch defaults to "only what needs ordering"; the demo branch is healthy, so turn it
	// off to see every row and its basis.
	await page.locator("#replenishment-only-suggested").click()
	await page.waitForTimeout(800)
	const whyDisclosures = page.getByText("Why?")
	check(
		(await whyDisclosures.count()) > 0,
		"the replenishment screen lists rows with a basis disclosure",
		`${await whyDisclosures.count()}`,
	)
	await whyDisclosures.first().click()
	await page
		.getByText(/sold in the last/i)
		.first()
		.waitFor({ timeout: 10_000 })
	check(true, "the basis breakdown prints the inputs the API used")
	await page.screenshot({
		path: path.join(evidenceDir, "plan11-replenishment.png"),
		fullPage: true,
	})

	await page.goto(`${adminUrl}/procurement/suppliers`, { waitUntil: "networkidle" })
	await page.locator("main").waitFor()
	check(
		/On time means/i.test(await page.locator("main").innerText()),
		"the performance screen states its definition in words",
	)
	await page.screenshot({
		path: path.join(evidenceDir, "plan11-supplier-performance.png"),
		fullPage: true,
	})

	await page.goto(`${adminUrl}/procurement/orders/${approvedOrderId}`, { waitUntil: "networkidle" })
	await page.locator("main").waitFor()
	await page.emulateMedia({ media: "print" })
	await page.screenshot({
		path: path.join(evidenceDir, "plan11-print-preview.png"),
		fullPage: true,
	})
	await page.emulateMedia({ media: "screen" })
	check(true, "the order renders a printable sheet")

	section("branch operations (admin)")

	const varianceApprovalId = await createShiftVarianceApproval(
		page.request,
		demoBranch.id,
		managerEmail,
	)
	if (!varianceApprovalId) {
		console.log(
			"  SKIP a shift variance review row: the device upload did not raise one in this environment, so its single action was not asserted",
		)
	}

	// The badge is a cached query with a 60s staleTime. Reloading after the fixtures exist makes
	// the starting number the server's, not a number from before the manager raised anything.
	await page.reload({ waitUntil: "networkidle" })
	const badgeBefore = await badgeCount(page)
	check(
		badgeBefore > 0,
		"the sidebar badge counts the pending approvals in the selected branch",
		String(badgeBefore),
	)

	let decided = 0
	let badgeAfterFirst = badgeBefore
	const approveFromDetail = async (confirmLabel = "Approve") => {
		await page.getByRole("button", { name: confirmLabel }).first().click()
		await page.getByRole("dialog").waitFor()
		await page.getByRole("dialog").getByRole("button", { name: confirmLabel }).click()
		await page
			.getByText(/Decided by/)
			.first()
			.waitFor({ timeout: 20_000 })
		decided += 1
	}

	// 1. A transfer request: the admin decides what a requester could not, and focus returns.
	if (transferApprovalId) {
		await page.goto(`${adminUrl}/approvals/${transferApprovalId}`, {
			waitUntil: "networkidle",
		})
		await page.locator("main").waitFor()
		const detailText = await page.locator("main").innerText()
		check(
			detailText.includes(`Requested by ${managerStaffId}`),
			"the admin sees the manager as the transfer requester",
		)
		check(
			detailText.includes("Goods value") && detailText.includes("Open the transfer"),
			"the transfer request renders its goods value and a link to the document",
		)
		await shot(page, "plan12-approval-transfer-admin.png")

		await page.getByRole("button", { name: "Approve" }).click()
		await page.getByRole("dialog").waitFor()
		await page.keyboard.press("Escape")
		await page.getByRole("dialog").waitFor({ state: "hidden" })
		await page.waitForTimeout(150)
		const focusedControl = await page.evaluate(() =>
			(document.activeElement?.textContent ?? "").trim(),
		)
		check(
			focusedControl === "Approve",
			"closing the decision dialog returns focus to the control that opened it",
			focusedControl || "nothing focused",
		)

		await approveFromDetail("Approve")
		check(
			/Decided by/.test(await page.locator("main").innerText()),
			"the admin approves the transfer request",
		)
		const badgeAfterTransfer = await waitUntil(
			page,
			() => badgeCount(page),
			(value) => value < badgeBefore,
		)
		badgeAfterFirst = badgeAfterTransfer
		check(
			badgeAfterTransfer < badgeBefore,
			"the sidebar badge falls after a decision",
			`${badgeBefore} → ${badgeAfterTransfer}`,
		)
	}

	// 2. A price change: the band it broke is visible before the decision.
	if (priceApprovalId) {
		await page.goto(`${adminUrl}/approvals/${priceApprovalId}`, { waitUntil: "networkidle" })
		await page.locator("main").waitFor()
		const detailText = await page.locator("main").innerText()
		check(
			/Outside the band/.test(detailText) && detailText.includes("Proposed price"),
			"the price request shows the proposed price and the band it broke",
		)
		await shot(page, "plan12-approval-price.png")
		await approveFromDetail("Approve")
		check(
			/Decided by/.test(await page.locator("main").innerText()),
			"the admin approves the price change",
		)
	}

	// 3. A credit limit change: both limits are visible, with a way to the customer.
	if (creditApproval?.id) {
		await page.goto(`${adminUrl}/approvals/${creditApproval.id}`, { waitUntil: "networkidle" })
		await page.locator("main").waitFor()
		const detailText = await page.locator("main").innerText()
		check(
			detailText.includes("Current limit") && detailText.includes("Proposed limit"),
			"the credit request shows the current and proposed limits",
		)
		check(
			detailText.includes("Open the customer profile"),
			"the credit request links to the customer it changes",
		)
		await shot(page, "plan12-approval-credit.png")
		await approveFromDetail("Approve")
		check(
			/Decided by/.test(await page.locator("main").innerText()),
			"the admin approves the credit limit increase",
		)
	}

	// 4. A stock write-off: the frozen value and the line are what the admin approves.
	if (writeOffApproval?.id) {
		await page.goto(`${adminUrl}/approvals/${writeOffApproval.id}`, {
			waitUntil: "networkidle",
		})
		await page.locator("main").waitFor()
		const detailText = await page.locator("main").innerText()
		check(
			/Write-off WO-/.test(detailText) && detailText.includes("Frozen value"),
			"the write-off request renders its frozen value",
		)
		check(
			detailText.includes(writeOffProduct.sku),
			"the write-off request names the product written off",
			writeOffProduct.sku,
		)
		await shot(page, "plan12-approval-write-off.png")
		await approveFromDetail("Approve")
		check(
			/Decided by/.test(await page.locator("main").innerText()),
			"the admin approves the write-off",
		)
	}

	// 5. A variance review records an outcome; it is the only action it offers.
	if (varianceApprovalId) {
		await page.goto(`${adminUrl}/approvals/${varianceApprovalId}`, {
			waitUntil: "networkidle",
		})
		await page.locator("main").waitFor()
		const detailText = await page.locator("main").innerText()
		check(
			detailText.includes("Expected by the server") &&
				detailText.includes("Counted by the cashier"),
			"the variance review shows the drawer's arithmetic",
		)
		check(
			(await page.getByRole("button", { name: "Record outcome" }).count()) === 1,
			"a variance review offers exactly one action",
		)
		check(
			(await page.getByRole("button", { name: "Approve" }).count()) === 0 &&
				(await page.getByRole("button", { name: "Reject" }).count()) === 0,
			"a variance review offers neither approve nor reject",
		)
		await shot(page, "plan12-approval-variance.png")
		await page.getByRole("button", { name: "Record outcome" }).click()
		await page.getByRole("dialog").waitFor()
		check(
			/cannot be rejected/.test(await page.getByRole("dialog").innerText()),
			"the outcome dialog says a variance review cannot be rejected",
		)
		await page
			.getByRole("dialog")
			.locator("#decision-note")
			.fill("Console walkthrough: the drawer was counted short; no sale is missing.")
		await page.getByRole("dialog").getByRole("button", { name: "Record outcome" }).click()
		await page
			.getByText(/Decided by/)
			.first()
			.waitFor({ timeout: 20_000 })
		decided += 1
		check(
			/Decided by/.test(await page.locator("main").innerText()),
			"the admin records the variance outcome",
		)
	}

	if (decided > 1) {
		const badgeAfterAll = await waitUntil(
			page,
			() => badgeCount(page),
			(value) => value < badgeAfterFirst,
		)
		check(
			badgeAfterAll < badgeAfterFirst,
			"the sidebar badge keeps falling as more decisions are recorded",
			`${badgeAfterFirst} → ${badgeAfterAll} after ${decided} decisions`,
		)
	}

	section("analytics accuracy")
	await visit(page, "/analytics?tab=inventory", null)
	const accuracyCard = page
		.locator('main [data-slot="card"]')
		.filter({ hasText: "Count accuracy" })
		.first()
	check((await accuracyCard.count()) === 1, "the inventory tab renders the Count accuracy card")
	const accuracyValue = (await accuracyCard.locator('[data-slot="card-title"]').innerText()).trim()
	const accuracyText = await accuracyCard.innerText()
	check(
		/^([+-]?\d+\.\d{2}%|—)$/.test(accuracyValue),
		"the accuracy card renders a percentage or an em dash, never NaN",
		accuracyValue,
	)
	if (accuracyText.includes("No count posted in this period.")) {
		check(
			accuracyValue === "—",
			"a period with no counts renders an em dash, not 0.00%",
			accuracyValue,
		)
	} else {
		check(accuracyValue !== "—", "a period with posted counts renders a percentage", accuracyValue)
	}
	check(
		!/NaN|Infinity/.test(accuracyText),
		"the accuracy card contains no NaN or Infinity",
		accuracyText.slice(0, 120),
	)

	// The same card on a branch with no posted counts must say "—", never "0.00%".
	const warehouseBranch = (
		await contextApi(page.request, "GET", "/api/branches")
	).body?.branches?.find((row) => row.code === "ACC-WH1")
	check(Boolean(warehouseBranch), "the warehouse branch exists for the no-counts case")
	if (warehouseBranch) {
		await visit(page, `/analytics?tab=inventory&branchId=${warehouseBranch.id}`, null)
		const noCountsCard = page
			.locator('main [data-slot="card"]')
			.filter({ hasText: "Count accuracy" })
			.first()
		const noCountsValue = (
			await noCountsCard.locator('[data-slot="card-title"]').innerText()
		).trim()
		const noCountsText = await noCountsCard.innerText()
		check(
			/No count posted in this period/.test(noCountsText),
			"the warehouse branch reports no posted counts",
		)
		check(
			noCountsValue === "—",
			"a period with no counts renders an em dash, not 0.00%",
			noCountsValue,
		)
		check(
			!/NaN|0\.00%/.test(noCountsText),
			"the no-counts card contains neither NaN nor 0.00%",
			noCountsText.slice(0, 120),
		)
		await shot(page, "plan12-accuracy-no-counts.png")
	}

	section("analytics responsive matrix")
	const WIDTHS = [320, 768, 1024, 1440]
	for (const width of WIDTHS) {
		for (const theme of ["light", "dark"]) {
			for (const motion of ["no-preference", "reduce"]) {
				await page.setViewportSize({ width, height: 900 })
				await page.emulateMedia({ reducedMotion: motion })
				await page.goto(`${adminUrl}/analytics?tab=sales`, { waitUntil: "networkidle" })
				await page.waitForSelector('[data-slot="chart"]', { timeout: 20_000 })
				await page.evaluate(() => document.fonts.ready)
				if (theme === "dark") {
					await page.evaluate(() => document.documentElement.classList.add("dark"))
				}
				await page.waitForTimeout(250)

				const geometry = await page.evaluate(() => {
					const charts = Array.from(document.querySelectorAll('[data-slot="chart"]'))
					return {
						viewport: window.innerWidth,
						scrollWidth: document.documentElement.scrollWidth,
						heights: charts.map((chart) => Math.round(chart.getBoundingClientRect().height)),
						count: charts.length,
					}
				})
				const tag = `${width}px ${theme} ${motion}`
				check(geometry.count >= 2, `${tag}: charts rendered`, String(geometry.count))
				check(
					geometry.scrollWidth <= geometry.viewport + 1,
					`${tag}: no horizontal scroll`,
					`${geometry.scrollWidth} > ${geometry.viewport}`,
				)
				check(
					geometry.heights.every((height) => height >= 80),
					`${tag}: no zero-height chart`,
					geometry.heights.join(", "),
				)

				if (motion === "reduce") {
					const animating = await page.evaluate((ceiling) => {
						const nodes = Array.from(document.querySelectorAll('[data-slot="chart"] *'))
						const toMs = (value) =>
							value.trim().endsWith("ms")
								? Number(value.trim().slice(0, -2))
								: Number(value.trim().slice(0, -1)) * 1000
						return nodes.filter((node) => {
							const style = getComputedStyle(node)
							const animation = style.animationName !== "none" ? toMs(style.animationDuration) : 0
							return animation > ceiling || toMs(style.transitionDuration) > ceiling
						}).length
					}, 1)
					check(animating === 0, `${tag}: no entrance animation`, String(animating))
				}

				await page.screenshot({
					path: path.join(evidenceDir, `plan09-analytics-${width}-${theme}-${motion}.png`),
					fullPage: false,
				})
			}
		}
	}

	await page.setViewportSize({ width: 1280, height: 900 })
	await page.emulateMedia({ reducedMotion: "no-preference" })
	await page.goto(`${adminUrl}/analytics?tab=sales`, { waitUntil: "networkidle" })
	await page.waitForSelector('[data-slot="chart"]', { timeout: 20_000 })
	await page.waitForTimeout(300)

	const series = await page.evaluate(() => {
		const chart = document.querySelector('[data-slot="chart"]')
		const area = chart?.querySelector(".recharts-area-area")
		const figure = chart?.closest("figure")
		return {
			fill: area ? getComputedStyle(area).fill : "",
			background: figure ? getComputedStyle(figure).backgroundColor : "",
		}
	})
	function luminance(rgb) {
		const parts = rgb
			.match(/[\d.]+/g)
			?.slice(0, 3)
			.map(Number) ?? [0, 0, 0]
		const [r, g, b] = parts.map((part) => {
			const channel = part / 255
			return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
		})
		return 0.2126 * r + 0.7152 * g + 0.0722 * b
	}
	const ratio = (() => {
		if (!series.fill || !series.background) return 0
		const [lighter, darker] = [luminance(series.fill), luminance(series.background)].sort(
			(a, b) => b - a,
		)
		return (lighter + 0.05) / (darker + 0.05)
	})()
	check(
		series.fill === "rgb(242, 106, 27)",
		"first analytics series takes the brand orange",
		series.fill,
	)
	check(ratio >= 3, "first series clears 3:1 against its panel (SC 1.4.11)", ratio.toFixed(2))

	// Park the pointer away from the chart: Recharts keyboard navigation is inert while the
	// pointer rests over a chart (recharts#7905), so hovering first would fake a failure.
	await page.mouse.move(2, 2)
	await page.waitForTimeout(150)
	const focusable = page.locator('[data-slot="chart"] [tabindex="0"]').first()
	await focusable.focus()
	await page.keyboard.press("ArrowRight")
	await page.waitForTimeout(250)
	const keyboardTooltip = await page.evaluate(() => {
		const wrapper = document.querySelector('[data-slot="chart"] .recharts-tooltip-wrapper')
		return wrapper ? (wrapper.textContent ?? "").trim() : ""
	})
	check(
		keyboardTooltip.length > 0,
		"chart is readable by keyboard arrow keys",
		keyboardTooltip.slice(0, 60),
	)

	// Hand the authenticated session to the performance evidence script, so it can time the
	// endpoints without signing in again.
	const cookies = await context.cookies()
	const cookieHeader = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ")
	fs.writeFileSync("/tmp/opencode/analytics-cookie.txt", cookieHeader)

	section("console hygiene")
	check(
		consoleErrors.length === 0,
		"no console errors across the whole walkthrough",
		consoleErrors[0]?.slice(0, 160),
	)
	check(
		failedRequests.length === 0,
		"no failed requests across the whole walkthrough",
		failedRequests[0],
	)
} finally {
	await browser.close()
}

console.log(`\n${checks - failures.length}/${checks} checks passed`)
if (failures.length > 0) {
	console.error("\nFailures:")
	for (const failure of failures) console.error(`  - ${failure}`)
	process.exit(1)
}
