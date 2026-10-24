#!/usr/bin/env node
/**
 * Phase 8 Plan 13 — walk every console section on the migrated tree.
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
import { createHmac } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { chromium } from "playwright"

const adminUrl = process.env.ADMIN_URL ?? "http://localhost:3000"
const evidenceDir = process.env.EVIDENCE_DIR
	? path.resolve(process.env.EVIDENCE_DIR)
	: path.resolve(
			import.meta.dirname,
			"../../.planning/phases/08-admin-modules-shell/evidence/shots",
		)
const totpFile = process.env.TOTP_FILE ?? "/tmp/opencode/admin-totp.json"
const managerPasswordFile =
	process.env.MANAGER_PASSWORD_FILE ?? "/tmp/opencode/manager-password.txt"
fs.mkdirSync(evidenceDir, { recursive: true })

const repoRoot = path.resolve(import.meta.dirname, "../..")
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

function base32Decode(secret) {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
	let bits = ""
	for (const char of secret.replace(/=+$/, "").toUpperCase()) {
		const value = alphabet.indexOf(char)
		if (value === -1) continue
		bits += value.toString(2).padStart(5, "0")
	}
	const bytes = []
	for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2))
	return Buffer.from(bytes)
}

function totpCode(secret) {
	const counter = Math.floor(Date.now() / 1000 / 30)
	const buffer = Buffer.alloc(8)
	buffer.writeUInt32BE(Math.floor(counter / 2 ** 32), 0)
	buffer.writeUInt32BE(counter % 2 ** 32, 4)
	const digest = createHmac("sha1", base32Decode(secret)).update(buffer).digest()
	const offset = digest[digest.length - 1] & 0x0f
	const code =
		(((digest[offset] & 0x7f) << 24) |
			(digest[offset + 1] << 16) |
			(digest[offset + 2] << 8) |
			digest[offset + 3]) %
		1_000_000
	return String(code).padStart(6, "0")
}

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

	const url = new URL(page.url())
	if (url.pathname.startsWith("/two-factor")) {
		if (url.searchParams.get("setup")) {
			await page.getByText("Set up two-factor authentication").waitFor()
			await robustFill(page, "#current-password", password)
			await page.getByRole("button", { name: "Continue" }).click()
			await page.getByText("Scan this QR code").waitFor()
			await page.getByText("Can't scan? Show the manual key").click()
			const secret = (await page.locator("details p.font-mono").innerText()).trim()
			fs.mkdirSync(path.dirname(totpFile), { recursive: true })
			fs.writeFileSync(totpFile, JSON.stringify({ secret }))
			await page.getByRole("button", { name: "I've saved my backup codes" }).click()
			await page.getByText("Enter the code from your app").waitFor()
			await robustFill(page, "#code", totpCode(secret))
			await page.getByRole("button", { name: "Verify" }).click()
		} else {
			const { secret } = JSON.parse(fs.readFileSync(totpFile, "utf8"))
			await robustFill(page, "#code", totpCode(secret))
			await page.getByRole("button", { name: "Verify" }).click()
		}
		await page.waitForURL((value) => !new URL(value).pathname.startsWith("/two-factor"), {
			timeout: 30_000,
		})
	}
	await page.waitForLoadState("networkidle")
}

// --- sections ---------------------------------------------------------------

/** Text that must appear in `main`, or null when rendering alone is the assertion. */
const SECTIONS = [
	["/", "Welcome back"],
	["/branches", "Branches"],
	["/terminals", "Terminals"],
	["/staff", "Staff"],
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
	["/customers", "Customers"],
	["/customers/aging", "Aging"],
	["/loyalty", "Loyalty"],
	["/suppliers", "Suppliers"],
	["/suppliers/invoices", "Invoices"],
	["/suppliers/invoices/new", "New supplier invoice"],
	["/suppliers/payments", "Payments"],
	["/suppliers/aging", "Aging"],
	["/audit", "Audit"],
	["/settings", "Settings"],
]

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
	await page.locator("main").waitFor({ timeout: 20_000 })

	const text = await page.locator("main").innerText()
	const newErrors = consoleErrors.slice(before.errors)
	const newFailed = failedRequests.slice(before.failed)
	const broken = BROKEN.find((pattern) => pattern.test(text))

	const ok =
		page.url().includes(route.split("?")[0]) &&
		!broken &&
		newErrors.length === 0 &&
		newFailed.length === 0 &&
		(expected === null || text.includes(expected))

	check(
		ok,
		`${route} renders${expected ? ` "${expected}"` : ""}`,
		broken
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
	}

	section("detail screens")
	const inSection = async (listRoute, pattern, label) => {
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
		await visit(page, href, null)
		return href
	}

	await inSection("/branches", "^/branches/[^/]+$", "branch detail")
	await inSection("/catalog/products", "^/catalog/products/(?!new$)[^/]+$", "product detail")
	await inSection("/inventory/stock", "^/inventory/stock/[^/]+$", "stock detail")
	await inSection("/inventory/receipts", "^/inventory/receipts/[^/]+$", "receipt detail")
	await inSection("/suppliers", "^/suppliers/[^/]+$", "supplier detail")
	await inSection("/suppliers/invoices", "^/suppliers/invoices/[^/]+$", "invoice detail")
	await inSection("/suppliers/payments", "^/suppliers/payments/[^/]+$", "payment detail")

	const customerHref = await inSection("/customers", "^/customers/[^/]+$", "customer detail")
	if (customerHref) await visit(page, `${customerHref}/statement`, null)

	await page.goto(`${adminUrl}/`, { waitUntil: "networkidle" })
	await page.screenshot({
		path: path.join(evidenceDir, "plan08-admin-dashboard.png"),
		fullPage: true,
	})

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

	// A branch id smuggled into the query string must not change what a manager sees.
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

	await managerContext.close()

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
