#!/usr/bin/env node
/**
 * The website's external walkthrough. Proves the things a unit test cannot:
 * every route renders with one h1, the API content reaches the page, the
 * sitemap and robots routes answer, the JSON-LD parses, and nothing on the
 * site is a selling control.
 *
 *   bun run --filter web dev          # in one terminal
 *   bun run --filter web test:walkthrough
 *
 * Env: WEB_URL (default http://localhost:3004), API_URL (default :4000).
 */
import { chromium } from "playwright"

const WEB = (process.env.WEB_URL ?? "http://localhost:3004").replace(/\/+$/, "")
const API = (process.env.API_URL ?? "http://localhost:4000").replace(/\/+$/, "")

const ROUTES = [
	{ path: "/", title: "Sceptre Drive — auto spare parts in Ghana" },
	{ path: "/parts", title: "Parts index — Sceptre Drive" },
	{ path: "/services", title: "Services — Sceptre Drive" },
	{ path: "/branches", title: "Branches — Sceptre Drive" },
	{ path: "/about", title: "About — Sceptre Drive" },
	{ path: "/contact", title: "Contact — Sceptre Drive" },
	{ path: "/shop", title: "Shop — Sceptre Drive" },
]

let failed = 0
function check(ok, label, detail) {
	if (ok) {
		console.log(`PASS  ${label}`)
	} else {
		failed += 1
		console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`)
	}
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const consoleErrors = []
page.on("console", (message) => {
	if (message.type() === "error") consoleErrors.push(message.text().split("\n")[0])
})
page.on("pageerror", (error) => consoleErrors.push(error.message.split("\n")[0]))

for (const route of ROUTES) {
	await page.goto(`${WEB}${route.path}`, { waitUntil: "networkidle", timeout: 60_000 })
	const h1s = await page.locator("h1").count()
	const title = await page.title()
	const text = await page.locator("main").innerText()
	check(h1s === 1, `${route.path} has exactly one h1`, `${h1s} found`)
	check(title === route.title, `${route.path} title`, title)
	check(text.trim().length > 0, `${route.path} rendered content`)
}

// The endpoint's copy reached the page, not just the fallback.
const apiResponse = await page.request.get(`${API}/api/public/site`)
if (apiResponse.ok()) {
	const { content } = await apiResponse.json()
	await page.goto(`${WEB}/`, { waitUntil: "networkidle" })
	const heading = await page.locator("h1").first().innerText()
	check(
		heading.replace(/\s+/g, " ").trim() === content.site.heroHeading.replace(/\s+/g, " ").trim(),
		"the home h1 matches /api/public/site",
		`${heading} !== ${content.site.heroHeading}`,
	)
	const branchNames = content.branches.map((branch) => branch.name)
	if (branchNames.length > 0) {
		await page.goto(`${WEB}/branches`, { waitUntil: "networkidle" })
		const body = await page.locator("main").innerText()
		check(
			branchNames.every((name) => body.includes(name)),
			"every API branch is on /branches",
		)
	}
} else {
	console.log("SKIP  API content comparison (the site is serving its fallback)")
}

// Structured data.
await page.goto(`${WEB}/`, { waitUntil: "networkidle" })
const rawJsonLd = await page.locator('script[type="application/ld+json"]').textContent()
try {
	const jsonLd = JSON.parse(rawJsonLd ?? "{}")
	check(jsonLd["@type"] === "AutoPartsStore", "JSON-LD is an AutoPartsStore")
	check(typeof jsonLd.name === "string" && jsonLd.name.length > 0, "JSON-LD names the business")
	check(Array.isArray(jsonLd.department), "JSON-LD lists the branches as departments")
} catch (error) {
	check(false, "JSON-LD parses", String(error))
}

// Sitemap and robots.
const sitemap = await page.request.get(`${WEB}/sitemap.xml`)
const sitemapText = await sitemap.text()
check(sitemap.status() === 200, "sitemap.xml is 200", String(sitemap.status()))
check(
	ROUTES.every((route) => sitemapText.includes(route.path === "/" ? "<loc>" : `${route.path}<`)),
	"sitemap lists every route",
)
const robots = await page.request.get(`${WEB}/robots.txt`)
const robotsText = await robots.text()
check(robots.status() === 200, "robots.txt is 200", String(robots.status()))
check(robotsText.includes("/sitemap.xml"), "robots.txt points at the sitemap")

// Not a shop: no buying control on any page.
for (const route of ROUTES) {
	await page.goto(`${WEB}${route.path}`, { waitUntil: "networkidle" })
	const buyControls = await page
		.getByRole("button", { name: /add to cart|buy now|checkout|pay now/i })
		.count()
	const buyLinks = await page
		.getByRole("link", { name: /add to cart|buy now|checkout|pay now/i })
		.count()
	check(buyControls + buyLinks === 0, `${route.path} has no selling control`)
}

check(consoleErrors.length === 0, "no browser console errors", consoleErrors.join(" | "))

await browser.close()

if (failed > 0) {
	console.error(`\n${failed} check(s) failed`)
	process.exit(1)
}
console.log("\nall website checks passed")
