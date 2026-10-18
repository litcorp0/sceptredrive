import { createHmac } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { chromium } from "playwright"

const BASE = "http://localhost:3000"
const SECRET_FILE = "/tmp/opencode/admin-totp.json"
const SHOTS = "/tmp/opencode/shots"
mkdirSync(SHOTS, { recursive: true })

const env = readFileSync("/home/litcorp/Projects/Fullstack/gikautos/.env", "utf8")
const envValue = (key) => (env.match(new RegExp(`^${key}="?([^"\\n]*)`, "m")) ?? [])[1]
const ADMIN_EMAIL = envValue("ADMIN_EMAIL")
const ADMIN_PASSWORD = envValue("ADMIN_PASSWORD")
const MANAGER_EMAIL = "manager@gikautos.local"
const MANAGER_PASSWORD = "walkthrough-password-1234"

let passed = 0
let failed = 0

function check(label, condition, detail = "") {
	if (condition) {
		passed += 1
		console.log(`  PASS  ${label}`)
	} else {
		failed += 1
		console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`)
	}
}

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

const stamp = Date.now().toString(36).slice(-5)
const parentCategory = `Web Parent ${stamp}`
const childCategory = `Web Child ${stamp}`
const brandName = `WebBrand ${stamp}`
const unitCode = `WW${stamp.slice(0, 6)}`.toUpperCase()
const unitName = `Web Unit ${stamp}`
const productName = `Web Filter ${stamp}`
const barcode = `WEB${stamp.toUpperCase()}01`

const browser = await chromium.launch({ channel: "chromium" })
const context = await browser.newContext({ viewport: { width: 1440, height: 940 } })
const page = await context.newPage()
page.setDefaultTimeout(20_000)

async function shot(name) {
	await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })
}

async function selectOption(triggerSelector, optionName) {
	await page.locator(triggerSelector).click()
	await page.getByRole("option", { name: optionName }).first().click()
}

async function waitToast(text) {
	await page.getByText(text).first().waitFor({ state: "visible" })
}

/** Fills a controlled input after hydration; retries until the value sticks. */
async function robustFill(selector, value) {
	for (let attempt = 0; attempt < 10; attempt += 1) {
		await page.fill(selector, value)
		if ((await page.inputValue(selector)) === value) return
		await page.waitForTimeout(250)
	}
	throw new Error(`could not fill ${selector} (hydration race)`)
}

async function loginAsAdmin() {
	await page.goto(`${BASE}/login`)
	await page.waitForLoadState("networkidle")
	await robustFill("#email", ADMIN_EMAIL)
	await robustFill("#password", ADMIN_PASSWORD)
	await page.getByRole("button", { name: "Sign in" }).click()
	await page.waitForURL((url) => !new URL(url).pathname.startsWith("/login"), { timeout: 20_000 })

	if (!new URL(page.url()).pathname.startsWith("/two-factor")) return

	await page.waitForFunction(
		() => document.querySelector("#current-password") !== null || document.querySelector("#code") !== null,
	)
	const setupMode = (await page.locator("#current-password").count()) > 0
	if (setupMode) {
		await page.fill("#current-password", ADMIN_PASSWORD)
		await page.getByRole("button", { name: "Continue" }).click()
		const secretEl = page.locator("details p.font-mono").first()
		await secretEl.waitFor({ state: "attached" })
		const secret = ((await secretEl.textContent()) ?? "").trim()
		writeFileSync(SECRET_FILE, JSON.stringify({ secret }))
		console.log(`  INFO  TOTP set up; secret stored in ${SECRET_FILE}`)
		await page.getByRole("button", { name: "I've saved my backup codes" }).click()
		await page.fill("#code", totpCode(secret))
		await page.getByRole("button", { name: "Verify" }).click()
	} else {
		if (!existsSync(SECRET_FILE)) throw new Error("TOTP is enabled but no stored secret found")
		const { secret } = JSON.parse(readFileSync(SECRET_FILE, "utf8"))
		await page.fill("#code", totpCode(secret))
		await page.getByRole("button", { name: "Verify" }).click()
	}
	await page.waitForURL((url) => new URL(url).pathname === "/")
}

async function loginAsManager() {
	await page.goto(`${BASE}/login`)
	await page.waitForLoadState("networkidle")
	await robustFill("#email", MANAGER_EMAIL)
	await robustFill("#password", MANAGER_PASSWORD)
	await page.getByRole("button", { name: "Sign in" }).click()
	await page.waitForURL((url) => new URL(url).pathname === "/", { timeout: 20_000 })
}

console.log("== GikAutos browser walkthrough (real UI, real API) ==\n")

try {
	// ------------------------------------------------------------------
	console.log("-- Admin: sign-in with forced TOTP --")
	await loginAsAdmin()
	check("admin signs in past forced two-factor setup", new URL(page.url()).pathname === "/")
	await shot("01-dashboard")

	// ------------------------------------------------------------------
	console.log("\n-- Admin: catalog categories --")
	await page.getByRole("link", { name: "Catalog" }).click()
	await page.waitForURL("**/catalog/products")
	check("catalog opens on the products tab", page.url().endsWith("/catalog/products"))
	await shot("02-products-list")

	await page.getByRole("tab", { name: "Categories" }).click()
	await page.waitForURL("**/catalog/categories")
	await page.getByText("Engine", { exact: true }).first().waitFor()
	check("demo category tree renders", true)

	await page.getByRole("button", { name: "New category" }).click()
	await page.fill("#category-name", parentCategory)
	await page.getByRole("button", { name: "Create category" }).click()
	await waitToast("Category created")
	await page.locator("tbody").getByText(parentCategory, { exact: true }).first().waitFor()
	check("admin creates a top-level category from the dialog", true)

	await page.getByRole("button", { name: "New category" }).click()
	await page.fill("#category-name", childCategory)
	await selectOption("#category-parent", parentCategory)
	await page.getByRole("button", { name: "Create category" }).click()
	await waitToast("Category created")
	await page.locator("tbody").getByText(childCategory).first().waitFor()
	check("admin creates a subcategory under the new parent", true)
	await shot("03-categories")

	// ------------------------------------------------------------------
	console.log("\n-- Admin: brands and units --")
	await page.getByRole("tab", { name: "Brands" }).click()
	await page.waitForURL("**/catalog/brands")
	await page.getByRole("button", { name: "New brand" }).click()
	await page.fill("#brand-name", brandName)
	await page.getByRole("button", { name: "Create brand" }).click()
	await waitToast("Brand created")
	await page.locator("tbody").getByText(brandName, { exact: true }).first().waitFor()
	check("admin creates a brand", true)

	await page.getByRole("tab", { name: "Units" }).click()
	await page.waitForURL("**/catalog/units")
	await page.getByRole("button", { name: "New unit" }).click()
	await page.fill("#unit-code", unitCode.toLowerCase())
	await page.fill("#unit-name", unitName)
	await page.getByRole("button", { name: "Create unit" }).click()
	await waitToast("Unit created")
	await page.locator("tbody").getByText(unitCode, { exact: true }).first().waitFor()
	check("admin creates a unit and the code is uppercased", true)

	// ------------------------------------------------------------------
	console.log("\n-- Admin: create a product with tax preview and barcode --")
	await page.getByRole("tab", { name: "Products" }).click()
	await page.waitForURL("**/catalog/products")
	await page.getByRole("link", { name: "New product" }).click()
	await page.waitForURL("**/catalog/products/new")

	const sku = await page
		.waitForFunction(() => {
			const input = document.querySelector("#product-sku")
			return input && input.value.length > 0 ? input.value : false
		}, { timeout: 10_000 })
		.then((handle) => handle.jsonValue())
		.catch(() => "")
	check("SKU is suggested on load", /^GIK-\d+$/.test(sku), sku)

	await page.fill("#product-name", productName)
	await selectOption("#product-category", new RegExp(childCategory))
	await selectOption("#product-brand", new RegExp(brandName))
	await selectOption("#product-unit", new RegExp(unitCode))
	await page.fill("#product-base-price", "100.00")

	await page.fill("#barcode-input", barcode)
	await page.getByRole("button", { name: "Add", exact: true }).click()
	await page.getByText(barcode, { exact: true }).waitFor()
	check("barcode chip appears in the editor", true)

	await page.getByText("Tax-inclusive").waitFor()
	await page.getByText("GHS 83.33").first().waitFor()
	check("tax preview shows the inclusive base (83.33 of 100.00)", true)
	await page.getByText("GHS 12.51").first().waitFor()
	check("tax preview shows the residual-adjusted VAT (12.51)", true)
	await shot("04-new-product")

	await page.getByRole("button", { name: "Create product" }).click()
	await page.waitForURL(/\/catalog\/products\/[0-9a-f-]{36}$/)
	await waitToast("Product created")
	const productId = page.url().split("/").pop()
	check("product saves and opens the editor", Boolean(productId))
	await page.getByText(barcode, { exact: true }).waitFor()
	check("barcode persisted on the product", true)
	await shot("05-product-editor")

	// ------------------------------------------------------------------
	console.log("\n-- Admin: branch price override --")
	const accRow = page.locator("form").filter({ hasText: "ACC-SPX" }).first()
	await accRow.locator("input").fill("95.00")
	await accRow.getByRole("button", { name: "Save" }).click()
	await waitToast("Override saved for ACC-SPX")
	await accRow.getByText("GHS 95.00").first().waitFor()
	check("admin sets an ACC-SPX override from the panel", true)

	// ------------------------------------------------------------------
	console.log("\n-- Admin: list search, filters, effective pricing --")
	await page.getByRole("link", { name: "Back to products" }).click()
	await page.waitForURL("**/catalog/products")
	await selectOption('button[aria-label="Active branch"]', "ACC-SPX")
	await page.getByRole("columnheader", { name: "Effective" }).waitFor()
	check("effective price column appears with a branch selected", true)

	await page.getByLabel("Search products").fill(barcode)
	await page.getByRole("row", { name: new RegExp(productName) }).first().waitFor()
	check("search by exact barcode finds the product row", true)
	const rowText = await page.getByRole("row", { name: new RegExp(productName) }).first().innerText()
	check("row shows the effective override price", rowText.includes("GHS 95.00"), rowText)
	await shot("06-list-effective")

	// ------------------------------------------------------------------
	console.log("\n-- Admin: tax mode setting flips the preview --")
	await page.getByRole("link", { name: "Settings" }).click()
	await page.waitForURL("**/settings")
	const taxRow = page.locator("form").filter({ hasText: "Tax mode" }).first()
	await taxRow.getByRole("combobox").click()
	await page.getByRole("option", { name: "Tax-exclusive prices" }).click()
	await taxRow.getByRole("button", { name: "Save" }).click()
	await waitToast("Setting saved")
	check("admin switches pricing.taxMode to EXCLUSIVE", true)

	await page.goto(`${BASE}/catalog/products/${productId}`)
	await page.getByText("Tax-exclusive").waitFor()
	await page.getByText("GHS 15.00").first().waitFor()
	check("exclusive preview adds 15% VAT on the base (100.00 -> 15.00)", true)
	await page.getByText("GHS 120.00").first().waitFor()
	check("exclusive preview totals 120.00", true)
	await shot("07-tax-exclusive")

	await page.getByRole("link", { name: "Settings" }).click()
	await page.waitForURL("**/settings")
	await taxRow.getByRole("combobox").click()
	await page.getByRole("option", { name: "Tax-inclusive prices" }).click()
	await taxRow.getByRole("button", { name: "Save" }).click()
	await waitToast("Setting saved")
	check("admin reverts pricing.taxMode to INCLUSIVE", true)

	// ------------------------------------------------------------------
	console.log("\n-- Manager: read-only catalog and own-branch override --")
	await page.getByRole("button", { name: "GikAutos Admin" }).click()
	await page.getByRole("menuitem", { name: "Sign out" }).click()
	await page.waitForURL("**/login")

	await loginAsManager()
	await page.getByRole("link", { name: "Catalog" }).click()
	await page.waitForURL("**/catalog/products")
	await page.getByLabel("Search products").fill(barcode)
	await page.getByRole("row", { name: new RegExp(productName) }).first().waitFor()
	check("manager sees the catalog list", true)
	check(
		"manager sees no New product action",
		(await page.getByRole("link", { name: "New product" }).count()) === 0,
	)
	check(
		"manager sees no archive actions",
		(await page.getByRole("button", { name: "Archive", exact: true }).count()) === 0,
	)

	await page.goto(`${BASE}/catalog/products/${productId}`)
	await page.locator("#product-name").waitFor()
	check("manager cannot edit product fields", await page.locator("#product-name").isDisabled())
	check(
		"manager sees no product archive button",
		(await page.getByRole("button", { name: "Archive product" }).count()) === 0,
	)

	const managerAccRow = page.locator("form").filter({ hasText: "ACC-SPX" }).first()
	await managerAccRow.locator("input").fill("92.50")
	await managerAccRow.getByRole("button", { name: "Save" }).click()
	await waitToast("Override saved for ACC-SPX")
	check("manager sets their own-branch override", true)
	await shot("08-manager-override")
	check(
		"manager panel lists only their own branch",
		(await page.locator("form").filter({ hasText: "ACC-WH1" }).count()) === 0,
	)

	await page.getByRole("tab", { name: "Categories" }).click()
	await page.waitForURL("**/catalog/categories")
	check(
		"manager sees no category editing actions",
		(await page.getByRole("button", { name: "New category" }).count()) === 0 &&
			(await page.getByRole("button", { name: "Edit", exact: true }).count()) === 0,
	)
} catch (error) {
	failed += 1
	console.error("\nWALKTHROUGH CRASHED:", error.message)
	await shot("99-crash")
} finally {
	await browser.close()
}

console.log(`\n== ${passed} passed, ${failed} failed ==`)
console.log(`Screenshots in ${SHOTS}`)
process.exit(failed > 0 ? 1 : 0)
