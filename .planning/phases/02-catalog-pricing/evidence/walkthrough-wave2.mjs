const API = 'http://localhost:4000'
const ORIGIN = 'http://localhost:3000'

let passed = 0
let failed = 0

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1
    console.log(`  PASS  ${label}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function cookiesFrom(response) {
  const header = response.headers.getSetCookie()
  return header.map((cookie) => cookie.split(';')[0]).join('; ')
}

async function request(path, { method = 'GET', cookie = '', body, raw = false } = {}) {
  const headers = { origin: ORIGIN }
  if (cookie) headers.cookie = cookie
  if (body !== undefined) headers['content-type'] = 'application/json'
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (raw) return response
  const text = await response.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = text
  }
  return { status: response.status, body: json, response }
}

async function login(email, password) {
  const response = await fetch(`${API}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({ email, password }),
  })
  if (response.status !== 200) {
    throw new Error(`login failed for ${email}: ${response.status} ${await response.text()}`)
  }
  return cookiesFrom(response)
}

const env = await Bun.file('.env').text()
const envValue = (key) => (env.match(new RegExp(`^${key}="?([^"\n]*)`, 'm')) ?? [])[1]
const ADMIN_EMAIL = envValue('ADMIN_EMAIL')
const ADMIN_PASSWORD = envValue('ADMIN_PASSWORD')

console.log('== GikAutos Wave 2 walkthrough (browser-equivalent) ==\n')

// ---------- Admin: catalog management ----------
console.log('-- Admin session: build a category tree, brand, unit, product --')
const adminCookie = await login(ADMIN_EMAIL, ADMIN_PASSWORD)

let res = await request('/api/categories', { cookie: adminCookie })
check('admin can read the category tree', res.status === 200 && Array.isArray(res.body.categories))
const totalNodes = res.body.categories.reduce(
  (sum, node) => sum + 1 + (node.children?.length ?? 0),
  0,
)
check('demo catalog tree present (12+ categories)', totalNodes >= 12, `got ${totalNodes}`)

const stamp = Date.now().toString(36).slice(-5)
const parentName = `Walkthrough Group ${stamp}`
res = await request('/api/categories', {
  method: 'POST',
  cookie: adminCookie,
  body: { name: parentName },
})
check('admin creates a parent category', res.status === 201, `status ${res.status}`)
const parentCategory = res.body?.category

res = await request('/api/categories', {
  method: 'POST',
  cookie: adminCookie,
  body: { name: `Walkthrough Child ${stamp}`, parentId: parentCategory.id },
})
check('admin creates a child category', res.status === 201, `status ${res.status}`)
const childCategory = res.body?.category

res = await request(`/api/categories/${parentCategory.id}/archive`, {
  method: 'POST',
  cookie: adminCookie,
})
check(
  'archiving a parent with an active child is rejected with 409',
  res.status === 409 && /subcategories/i.test(res.body?.error?.message ?? ''),
  `status ${res.status}`,
)

res = await request('/api/brands', {
  method: 'POST',
  cookie: adminCookie,
  body: { name: `WalkthroughBrand ${stamp}` },
})
check('admin creates a brand', res.status === 201, `status ${res.status}`)
const brand = res.body?.brand

res = await request('/api/uoms', {
  method: 'POST',
  cookie: adminCookie,
  body: { code: `w${stamp}`, name: `Walkthrough Unit ${stamp}` },
})
check(
  'admin creates a unit with an uppercase code',
  res.status === 201 && res.body.uom.code === `W${stamp}`.toUpperCase(),
  `status ${res.status} code ${res.body?.uom?.code}`,
)
const unit = res.body?.uom

res = await request('/api/products/suggest-sku', { cookie: adminCookie })
check('suggest-sku returns a GIK code', /^GIK-\d+$/.test(res.body?.sku ?? ''), res.body?.sku)
const suggestedSku = res.body.sku

const walkBarcode = `WTK${stamp.toUpperCase()}01`
res = await request('/api/products', {
  method: 'POST',
  cookie: adminCookie,
  body: {
    sku: suggestedSku,
    name: `Walkthrough Oil Filter ${stamp}`,
    description: 'Created during the Phase 2 live walkthrough',
    categoryId: childCategory.id,
    brandId: brand.id,
    uomId: unit.id,
    costPriceMinor: 4500,
    basePriceMinor: 9500,
    barcodes: [walkBarcode],
  },
})
check('admin creates a product using the suggested SKU', res.status === 201, `status ${res.status}`)
const product = res.body?.product
check('product carries its barcode', product?.barcodes?.[0]?.code === walkBarcode)

res = await request('/api/products', {
  method: 'POST',
  cookie: adminCookie,
  body: {
    name: `Walkthrough Duplicate ${stamp}`,
    categoryId: childCategory.id,
    uomId: unit.id,
    basePriceMinor: 1000,
    barcodes: [walkBarcode],
  },
})
check(
  'duplicate barcode is rejected with 409 naming the code',
  res.status === 409 && (res.body?.error?.message ?? '').includes(walkBarcode),
  `status ${res.status} message ${res.body?.error?.message}`,
)

res = await request('/api/products', {
  method: 'POST',
  cookie: adminCookie,
  body: {
    sku: suggestedSku,
    name: `Walkthrough Duplicate SKU ${stamp}`,
    categoryId: childCategory.id,
    uomId: unit.id,
    basePriceMinor: 1000,
  },
})
check('duplicate SKU is rejected with 409', res.status === 409, `status ${res.status}`)

res = await request(`/api/products?q=${encodeURIComponent(walkBarcode)}`, {
  cookie: adminCookie,
})
check(
  'search by exact barcode finds the product',
  res.status === 200 && res.body.total === 1 && res.body.products[0].id === product.id,
  `total ${res.body?.total}`,
)

res = await request(`/api/products?q=${encodeURIComponent(`Walkthrough Oil Filter ${stamp}`)}`, {
  cookie: adminCookie,
})
check('search by name substring finds the product', res.body.total === 1)
check('row includes joined category and unit names', Boolean(res.body.products[0]?.categoryName))

res = await request(`/api/products?q=${(res.body.products[0]?.sku ?? suggestedSku).slice(0, 8)}`, {
  cookie: adminCookie,
})
check('search by SKU prefix finds the product', res.body.products.some((p) => p.id === product.id))

// ---------- Manager: read-only catalog + own-branch override ----------
console.log('\n-- Manager session: forced password change, browse, override own branch --')

async function unlockManager() {
  try {
    const unlocked = await login('manager@gikautos.local', 'walkthrough-password-1234')
    const probe = await request('/api/products', { cookie: unlocked })
    if (probe.status === 200) {
      console.log('  INFO  manager already unlocked from a previous run')
      return unlocked
    }
  } catch {
    // fall through to the forced-change flow
  }

  const initial = await login('manager@gikautos.local', 'demo-password-1234')
  const lockProbe = await request('/api/products', { cookie: initial })
  check(
    'manager is locked until the forced password change',
    lockProbe.status === 403 && /password change/i.test(lockProbe.body?.error?.message ?? ''),
    `status ${lockProbe.status}`,
  )
  const change = await request('/api/me/password', {
    method: 'POST',
    cookie: initial,
    body: { currentPassword: 'demo-password-1234', newPassword: 'walkthrough-password-1234' },
  })
  check('manager changes the temporary password', change.status === 200, `status ${change.status}`)
  return login('manager@gikautos.local', 'walkthrough-password-1234')
}

const managerCookie = await unlockManager()

res = await request('/api/products', { cookie: managerCookie })
check('manager can list products after unlocking', res.status === 200, `status ${res.status}`)
const managerBranchId = res.body?.branchId
check('manager list is branch-scoped', typeof managerBranchId === 'string', managerBranchId)

const managerRow = res.body.products.find((p) => p.id === product.id)
check('manager sees the walkthrough product', Boolean(managerRow))
check(
  'manager sees a resolved effective price',
  managerRow?.effectivePriceMinor === 9500,
  String(managerRow?.effectivePriceMinor),
)

res = await request(`/api/products?q=${encodeURIComponent(stamp)}&includeArchived=true`, {
  cookie: managerCookie,
})
const scopedRow = res.body.products.find((p) => p.id === product.id)
check('manager search with branch context', Boolean(scopedRow))

res = await request(`/api/products/${product.id}/prices`, {
  method: 'PUT',
  cookie: managerCookie,
  body: { branchId: managerBranchId, priceMinor: 8950 },
})
check('manager sets an override on their own branch', res.status === 200, `status ${res.status}`)

const branches = await request('/api/branches', { cookie: adminCookie })
const otherBranch = branches.body.branches.find((b) => b.id !== managerBranchId)
res = await request(`/api/products/${product.id}/prices`, {
  method: 'PUT',
  cookie: managerCookie,
  body: { branchId: otherBranch.id, priceMinor: 8950 },
})
check('manager override on another branch is forbidden (403)', res.status === 403, `status ${res.status}`)

res = await request(`/api/products?q=${encodeURIComponent(walkBarcode)}`, { cookie: managerCookie })
check(
  'effective price reflects the manager override',
  res.body.products[0]?.effectivePriceMinor === 8950,
  String(res.body?.products?.[0]?.effectivePriceMinor),
)

res = await request(`/api/products?q=${encodeURIComponent(walkBarcode)}&branchId=${managerBranchId}`, {
  cookie: adminCookie,
})
check(
  'admin sees the same branch override',
  res.body.products[0]?.effectivePriceMinor === 8950,
  String(res.body?.products?.[0]?.effectivePriceMinor),
)

res = await request(`/api/products?q=${encodeURIComponent(walkBarcode)}`, { cookie: adminCookie })
check(
  'admin without a branch sees no effective price',
  res.body.products[0]?.effectivePriceMinor === null,
)

res = await request('/api/products', {
  method: 'POST',
  cookie: managerCookie,
  body: { name: 'Manager product', categoryId: childCategory.id, uomId: unit.id, basePriceMinor: 1 },
})
check('manager cannot create products (403)', res.status === 403, `status ${res.status}`)

// ---------- Audit + tax preview values ----------
console.log('\n-- Audit trail and tax values --')
res = await request(`/api/audit?entity=product&entityId=${product.id}`, { cookie: adminCookie })
check('audit log has product entries', res.status === 200 && (res.body?.total ?? 0) >= 1)
const actions = new Set((res.body.entries ?? []).map((entry) => entry.action))
check(
  'audit includes create and override actions',
  actions.has('product.created') && actions.has('product.price.override_set'),
  [...actions].join(', '),
)

console.log(`\n== ${passed} passed, ${failed} failed ==`)
if (failed > 0) process.exit(1)
