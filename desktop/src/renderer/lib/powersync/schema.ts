import { column, Schema, Table } from '@powersync/web'

/**
 * Local PowerSync schema.
 *
 * Two kinds of table:
 *
 * - **Synced (read-only):** mirrors of server tables, snake_case column names,
 *   delivered by `powersync/sync-config.yaml`. The POS never writes these
 *   directly (D7) — PowerSync would put row writes in its CRUD upload queue,
 *   which is not our atomic unit (a sale is).
 * - **Local-only:** everything the terminal owns — config, session, staff
 *   bindings, shifts, sales, tenders, the outbox, pending deltas, and drafts.
 *   Writes here never enter the upload queue; Plan 08's uploader ships them.
 *
 * Conventions: dates are ISO text, booleans are integers (0/1), money is integer
 * minor units (pesewas), and `id` is implicit (PowerSync creates a text PK).
 */

const isoText = column.text
const minor = column.integer
const flag = column.integer

// --- Synced (server → terminal) ---------------------------------------------

export const product = new Table(
  {
    sku: column.text,
    name: column.text,
    description: column.text,
    category_id: column.text,
    brand_id: column.text,
    uom_id: column.text,
    cost_price_minor: minor,
    base_price_minor: minor,
    /** Needed to price the line's tax offline (added in Plan 06). */
    tax_category: column.text,
    is_active: flag,
    updated_at: isoText,
  },
  { indexes: { product_sku: ['sku'], product_name: ['name'] } },
)

export const barcode = new Table(
  {
    product_id: column.text,
    code: column.text,
  },
  { indexes: { barcode_code: ['code'], barcode_product: ['product_id'] } },
)

/** Global reference data: the brand name shown on a product card. */
export const brand = new Table({
  name: column.text,
  is_active: flag,
  updated_at: isoText,
})

export const productPrice = new Table(
  {
    product_id: column.text,
    branch_id: column.text,
    price_minor: minor,
    updated_at: isoText,
  },
  { indexes: { product_price_branch: ['branch_id'], product_price_product: ['product_id'] } },
)

export const stockLevel = new Table(
  {
    product_id: column.text,
    branch_id: column.text,
    quantity_on_hand: minor,
    avg_cost_minor: minor,
    updated_at: isoText,
  },
  { indexes: { stock_level_branch: ['branch_id'], stock_level_product: ['product_id'] } },
)

export const customer = new Table(
  {
    name: column.text,
    phone: column.text,
    email: column.text,
    address: column.text,
    created_branch_id: column.text,
    status: column.text,
    // The sync stream already excludes anonymized rows; keeping the column
    // locally lets the terminal filter defensively while a change is in flight.
    anonymized_at: column.text,
    created_at: isoText,
    updated_at: isoText,
  },
  { indexes: { customer_phone: ['phone'], customer_name: ['name'] } },
)

export const creditProfile = new Table(
  {
    customer_id: column.text,
    branch_id: column.text,
    limit_minor: minor,
    hold: flag,
    payment_term_days: minor,
    balance_minor: minor,
    updated_at: isoText,
  },
  { indexes: { credit_profile_branch: ['branch_id'], credit_profile_customer: ['customer_id'] } },
)

export const loyaltyAccount = new Table(
  {
    customer_id: column.text,
    balance_points: minor,
    updated_at: isoText,
  },
  { indexes: { loyalty_account_customer: ['customer_id'] } },
)

export const loyaltyLot = new Table(
  {
    account_id: column.text,
    earn_entry_id: column.text,
    points: minor,
    remaining_points: minor,
    expires_at: isoText,
  },
  { indexes: { loyalty_lot_account: ['account_id'], loyalty_lot_expiry: ['expires_at'] } },
)

// --- Local-only (terminal owns) ---------------------------------------------

/** Singleton row (`id = 'current'`) written from `POST /api/pos/session`. */
export const posConfig = new Table(
  {
    device_id: column.text,
    terminal_id: column.text,
    terminal_code: column.text,
    branch_id: column.text,
    branch_code: column.text,
    branch_name: column.text,
    tax_mode: column.text,
    receipt_header: column.text,
    receipt_footer: column.text,
    sync_batch_size: minor,
    /** Full snapshot as JSON so new settings need no schema change. */
    config_json: column.text,
    /** `serverTime - localTime` in ms, applied to every local timestamp. */
    server_time_offset_ms: minor,
    updated_at: isoText,
  },
  { localOnly: true },
)

export const posSession = new Table(
  {
    device_id: column.text,
    status: column.text,
    access_token_expires_at: isoText,
    last_sync_at: isoText,
    updated_at: isoText,
  },
  { localOnly: true },
)

/** Offline PIN binding (Plan 04). The verifier is device-bound, never the server hash. */
export const staffBinding = new Table(
  {
    user_id: column.text,
    staff_id: column.text,
    name: column.text,
    role: column.text,
    /** Server `pos_staff_binding.id`, used to revalidate online. */
    binding_id: column.text,
    /** Server-issued binding token; encrypted at rest with the database. */
    binding_token: column.text,
    /** Server binding expiry (ISO); a stale binding needs re-authorization. */
    expires_at: isoText,
    pin_salt: column.text,
    pin_verifier: column.text,
    pin_version: minor,
    pin_must_change: flag,
    failed_attempts: minor,
    locked_until: isoText,
    is_active: flag,
    bound_at: isoText,
  },
  { localOnly: true, indexes: { staff_binding_staff: ['staff_id'] } },
)

export const shift = new Table(
  {
    number: column.text,
    branch_id: column.text,
    terminal_id: column.text,
    device_id: column.text,
    cashier_user_id: column.text,
    cashier_staff_id: column.text,
    status: column.text,
    opened_at: isoText,
    closed_at: isoText,
    opening_float_minor: minor,
    counted_cash_minor: minor,
    client_expected_cash_minor: minor,
    close_note: column.text,
    opened_by: column.text,
    closed_by: column.text,
    created_at: isoText,
  },
  { localOnly: true, indexes: { shift_status: ['status'], shift_terminal: ['terminal_id'] } },
)

export const sale = new Table(
  {
    receipt_number: column.text,
    branch_id: column.text,
    terminal_id: column.text,
    device_id: column.text,
    shift_id: column.text,
    client_transaction_id: column.text,
    cashier_user_id: column.text,
    cashier_staff_id: column.text,
    customer_id: column.text,
    occurred_at: isoText,
    subtotal_minor: minor,
    line_discount_minor: minor,
    sale_discount_minor: minor,
    loyalty_redeem_points: minor,
    loyalty_discount_minor: minor,
    vat_minor: minor,
    nhil_minor: minor,
    getfund_minor: minor,
    tax_total_minor: minor,
    total_minor: minor,
    tender_total_minor: minor,
    change_minor: minor,
    loyalty_earned_points: minor,
    credit_amount_minor: minor,
    tax_mode: column.text,
    app_version: column.text,
    /** `pending` until the printer confirms; a print failure never voids a sale. */
    print_status: column.text,
    printed_at: isoText,
    /** Short code/message from the last failed print attempt (never PII). */
    print_error: column.text,
    /** How many times this receipt was reprinted (the marker is printed too). */
    reprint_count: minor,
    created_at: isoText,
  },
  {
    localOnly: true,
    indexes: {
      /** The shift-close totals: every sale of one shift. */
      sale_shift: ['shift_id'],
      /** The sales-screen scan: one day across the table. */
      sale_occurred: ['occurred_at'],
      /**
       * The home screen's aggregates: `terminal_id` first, because every home
       * query filters on this terminal and only then on the Accra day window
       * (`occurred_at >= ? AND occurred_at < ?`). P10-D12.
       */
      sale_terminal_occurred: ['terminal_id', 'occurred_at'],
    },
  },
)

export const saleLine = new Table(
  {
    sale_id: column.text,
    product_id: column.text,
    line_number: minor,
    sku: column.text,
    name: column.text,
    barcode: column.text,
    quantity: minor,
    unit_price_minor: minor,
    expected_unit_price_minor: minor,
    line_discount_minor: minor,
    sale_discount_minor: minor,
    loyalty_discount_minor: minor,
    net_minor: minor,
    taxable_minor: minor,
    base_minor: minor,
    vat_minor: minor,
    nhil_minor: minor,
    getfund_minor: minor,
    tax_total_minor: minor,
    total_minor: minor,
    tax_category: column.text,
  },
  { localOnly: true, indexes: { sale_line_sale: ['sale_id'], sale_line_product: ['product_id'] } },
)

/**
 * One row per tender, in the order the customer paid (P13-D1).
 *
 * `sequence` is what makes a split receipt deterministic: two cash tenders on
 * one sale have the same `created_at`, so the order has to be a column. The
 * three new columns are additive — a till upgrading from Phase 12 keeps its old
 * rows, which read back with `sequence` null and are ordered by `created_at`.
 */
export const saleTender = new Table(
  {
    sale_id: column.text,
    sequence: minor,
    method: column.text,
    amount_minor: minor,
    reference: column.text,
    /** The server `payment` behind an electronic tender; null for cash/credit. */
    payment_id: column.text,
    /** The provider's own reference, kept for a reprint after the sale uploads. */
    provider_reference: column.text,
    created_at: isoText,
  },
  {
    localOnly: true,
    indexes: {
      sale_tender_sale: ['sale_id'],
      sale_tender_sale_sequence: ['sale_id', 'sequence'],
    },
  },
)

export const cashMovement = new Table(
  {
    shift_id: column.text,
    branch_id: column.text,
    terminal_id: column.text,
    device_id: column.text,
    type: column.text,
    amount_minor: minor,
    reason: column.text,
    occurred_at: isoText,
    staff_user_id: column.text,
    staff_staff_id: column.text,
  },
  { localOnly: true, indexes: { cash_movement_shift: ['shift_id'] } },
)

/**
 * A credit repayment taken at this till (P20-D1).
 *
 * The credit ledger deliberately never syncs to the terminal, so the drawer
 * cannot read a repayment back out of it. One row per repayment — written in the
 * same transaction as its `CREDIT_REPAYMENT` outbox row — is what lets the
 * close count the notes the cashier is holding. Only `method = 'CASH'` raised
 * expected cash; a MoMo repayment never touched the drawer.
 */
export const creditRepayment = new Table(
  {
    client_transaction_id: column.text,
    number: column.text,
    shift_id: column.text,
    customer_id: column.text,
    customer_name: column.text,
    amount_minor: minor,
    method: column.text,
    occurred_at: isoText,
    cashier_user_id: column.text,
    cashier_staff_id: column.text,
  },
  { localOnly: true, indexes: { credit_repayment_shift: ['shift_id'] } },
)

/**
 * The in-progress sale (Plan 06).
 *
 * One row per terminal: the `id` is the **future sale id / client transaction
 * id**, so the receipt and the upload row can be written the instant the sale
 * completes. Written after every cart mutation, in one transaction with its
 * lines, and restored on launch while the shift still matches.
 */
export const cartDraft = new Table(
  {
    shift_id: column.text,
    customer_id: column.text,
    customer_draft_id: column.text,
    customer_name: column.text,
    customer_phone: column.text,
    loyalty_redeem_points: minor,
    sale_discount_minor: minor,
    sale_discount_reason: column.text,
    sale_discount_note: column.text,
    /** JSON `OverrideProof` for the sale discount (manager PIN), or null. */
    sale_discount_override: column.text,
    /** JSON `OverrideProof` for the credit tender (manager PIN), or null. */
    credit_override: column.text,
    updated_at: isoText,
  },
  { localOnly: true, indexes: { cart_draft_updated: ['updated_at'] } },
)

export const cartDraftLine = new Table(
  {
    draft_id: column.text,
    line_number: minor,
    line_id: column.text,
    product_id: column.text,
    sku: column.text,
    name: column.text,
    barcode: column.text,
    quantity: minor,
    unit_price_minor: minor,
    tax_category: column.text,
    line_discount_minor: minor,
    line_discount_reason: column.text,
    line_discount_note: column.text,
    /** JSON `OverrideProof` when the line discount needed manager approval. */
    line_discount_override: column.text,
  },
  { localOnly: true, indexes: { cart_draft_line_draft: ['draft_id'] } },
)

/**
 * The tenders in flight on the current draft (P13-D31).
 *
 * A MoMo authorisation lasts up to 180 seconds and the till can crash inside
 * it. The draft's tenders are therefore persisted beside the draft, in the same
 * debounced write, so a restart resumes at the pending tender instead of
 * forgetting that GH₵50 is in flight. Cleared in the transaction that writes
 * `sale_tender`.
 *
 * `status` is `PENDING | PAID | FAILED | EXPIRED` — this is the *payment's*
 * state, copied for the screen; the sale itself is only written once the set
 * balances (P13-D5).
 */
export const cartTender = new Table(
  {
    draft_id: column.text,
    sequence: minor,
    method: column.text,
    amount_minor: minor,
    /** Paystack mobile-money network (`mtn`, `vod`, ...) for an in-flight charge. */
    momo_provider: column.text,
    phone: column.text,
    payment_id: column.text,
    provider_reference: column.text,
    status: column.text,
    /** The sentence the screen shows while waiting; never a secret. */
    display_text: column.text,
    expires_at: isoText,
    created_at: isoText,
  },
  { localOnly: true, indexes: { cart_tender_draft: ['draft_id'] } },
)

/**
 * A parked cart (P13-D29), deliberately not `cart_draft`: the draft is
 * single-active by construction and is pruned by shift, while a hold must
 * survive a restart and a shift change and be visible to every cashier on the
 * terminal.
 *
 * The discount proofs are the JSON a recall re-prices against; nothing here is
 * money the server has seen yet.
 */
export const heldCart = new Table(
  {
    label: column.text,
    held_at: isoText,
    held_by_user_id: column.text,
    held_by_staff_id: column.text,
    shift_id: column.text,
    customer_id: column.text,
    customer_name: column.text,
    customer_phone: column.text,
    loyalty_redeem_points: minor,
    sale_discount_minor: minor,
    sale_discount_reason: column.text,
    sale_discount_note: column.text,
    sale_discount_override: column.text,
    subtotal_minor: minor,
    total_minor: minor,
    item_count: minor,
  },
  { localOnly: true, indexes: { held_cart_held_at: ['held_at'] } },
)

export const heldCartLine = new Table(
  {
    hold_id: column.text,
    line_number: minor,
    product_id: column.text,
    sku: column.text,
    name: column.text,
    barcode: column.text,
    quantity: minor,
    unit_price_minor: minor,
    tax_category: column.text,
    line_discount_minor: minor,
    line_discount_reason: column.text,
    line_discount_note: column.text,
    line_discount_override: column.text,
  },
  { localOnly: true, indexes: { held_cart_line_hold: ['hold_id'] } },
)

/**
 * A voided cart (P13-D28): a reason-coded fact with no money and no PIN, kept so
 * a report can count abandoned baskets instead of leaving them invisible.
 */
export const cartVoid = new Table(
  {
    shift_id: column.text,
    reason_code: column.text,
    note: column.text,
    item_count: minor,
    gross_minor: minor,
    label: column.text,
    /** JSON snapshot of the abandoned lines, so the void can be read. */
    lines: column.text,
    occurred_at: isoText,
    created_at: isoText,
  },
  { localOnly: true, indexes: { cart_void_created: ['created_at'] } },
)

/**
 * The local mirror of a refund document (P13-D17/D19).
 *
 * The till has to know what is still refundable with the network unplugged, so
 * the caps are computed from these rows, not from a server answer. The tax
 * columns are the reversal as `taxBreakdown` computed it, never `total × 0.2`.
 */
export const refund = new Table(
  {
    number: column.text,
    sale_id: column.text,
    shift_id: column.text,
    reason_code: column.text,
    note: column.text,
    refunded_minor: minor,
    base_minor: minor,
    vat_minor: minor,
    nhil_minor: minor,
    getfund_minor: minor,
    tax_total_minor: minor,
    total_minor: minor,
    approved_by_staff_id: column.text,
    approved_at: isoText,
    occurred_at: isoText,
    created_at: isoText,
  },
  { localOnly: true, indexes: { refund_sale: ['sale_id'] } },
)

export const refundLine = new Table(
  {
    refund_id: column.text,
    sale_line_id: column.text,
    quantity: minor,
    /** `RESALABLE | DAMAGED | NOT_RETURNED`; only the first moves stock back. */
    restock: column.text,
    damage_reason: column.text,
    total_minor: minor,
  },
  {
    localOnly: true,
    indexes: {
      refund_line_refund: ['refund_id'],
      refund_line_sale_line: ['sale_line_id'],
    },
  },
)

export const refundTender = new Table(
  {
    refund_id: column.text,
    sequence: minor,
    method: column.text,
    amount_minor: minor,
    sale_tender_id: column.text,
    payment_id: column.text,
    status: column.text,
  },
  { localOnly: true, indexes: { refund_tender_refund: ['refund_id'] } },
)

/**
 * The Z-report snapshot (P13-D32), written by the close in the same transaction
 * that closes the shift. One row per shift, no update path: a correction is a
 * new document, never an edit. The columns mirror the server table so a printed
 * report and the console cannot disagree about the figures.
 */
export const shiftReport = new Table(
  {
    shift_id: column.text,
    branch_id: column.text,
    terminal_id: column.text,
    device_id: column.text,
    number: column.text,
    opened_at: isoText,
    closed_at: isoText,
    opening_float_minor: minor,
    sale_count: minor,
    item_count: minor,
    refund_count: minor,
    void_count: minor,
    gross_minor: minor,
    refund_minor: minor,
    net_minor: minor,
    line_discount_minor: minor,
    sale_discount_minor: minor,
    loyalty_discount_minor: minor,
    loyalty_redeem_points: minor,
    loyalty_earned_points: minor,
    base_minor: minor,
    vat_minor: minor,
    nhil_minor: minor,
    getfund_minor: minor,
    tax_total_minor: minor,
    cash_minor: minor,
    credit_minor: minor,
    momo_minor: minor,
    card_minor: minor,
    bank_transfer_minor: minor,
    change_minor: minor,
    cash_in_minor: minor,
    cash_out_minor: minor,
    /** Cash taken against credit in this drawer (P20-D1). */
    cash_repayment_minor: minor,
    expected_cash_minor: minor,
    counted_cash_minor: minor,
    variance_minor: minor,
    created_at: isoText,
  },
  { localOnly: true, indexes: { shift_report_shift: ['shift_id'] } },
)

/** Offline-created customer. `acked_at` is set once the server resolves the id. */
export const customerDraft = new Table(
  {
    name: column.text,
    phone: column.text,
    created_at: isoText,
    linked_customer_id: column.text,
    acked_at: isoText,
  },
  { localOnly: true, indexes: { customer_draft_phone: ['phone'] } },
)

/** Durable upload queue (D11): one row per client transaction, strict FIFO. */
export const outbox = new Table(
  {
    client_transaction_id: column.text,
    type: column.text,
    occurred_at: isoText,
    payload_version: minor,
    payload: column.text,
    status: column.text,
    attempts: minor,
    next_attempt_at: isoText,
    /** Legacy free-text error; Plan 08 writes the structured pair below. */
    last_error: column.text,
    last_error_code: column.text,
    last_error_message: column.text,
    server_result: column.text,
    acked_at: isoText,
    created_at: isoText,
    updated_at: isoText,
  },
  {
    localOnly: true,
    indexes: {
      outbox_status_created: ['status', 'created_at'],
      outbox_transaction: ['client_transaction_id'],
      outbox_next_attempt: ['next_attempt_at'],
    },
  },
)

export const localStockDelta = new Table(
  {
    sale_id: column.text,
    product_id: column.text,
    quantity_delta: minor,
    acked_at: isoText,
  },
  {
    localOnly: true,
    indexes: { local_stock_delta_product: ['product_id'], local_stock_delta_sale: ['sale_id'] },
  },
)

export const localCreditDelta = new Table(
  {
    sale_id: column.text,
    customer_id: column.text,
    amount_minor: minor,
    acked_at: isoText,
  },
  {
    localOnly: true,
    indexes: {
      local_credit_delta_customer: ['customer_id'],
      local_credit_delta_sale: ['sale_id'],
    },
  },
)

export const localLoyaltyDelta = new Table(
  {
    sale_id: column.text,
    customer_id: column.text,
    points_delta: minor,
    acked_at: isoText,
  },
  {
    localOnly: true,
    indexes: {
      local_loyalty_delta_customer: ['customer_id'],
      local_loyalty_delta_sale: ['sale_id'],
    },
  },
)

/** Terminal-scoped receipt/shift numbering: `(terminal_id, scope, day)`. */
export const documentSequence = new Table(
  {
    terminal_id: column.text,
    scope: column.text,
    day: column.text,
    last_value: minor,
  },
  {
    localOnly: true,
    indexes: { document_sequence_key: ['terminal_id', 'scope', 'day'] },
  },
)

/**
 * Per-device settings that live only on the terminal (Plan 07): the printer
 * target, drawer pin, charset, copies, and the cedi glyph preference.
 *
 * Server policy stays in `pos_config`; these are hardware facts the back office
 * cannot know. `id` is the setting key, so read/write is a simple upsert.
 */
export const deviceSetting = new Table(
  {
    key: column.text,
    value: column.text,
    updated_at: isoText,
  },
  { localOnly: true, indexes: { device_setting_key: ['key'] } },
)

/** Device copy of server-raised sync conflicts, for the POS status panel. */
export const syncConflictLocal = new Table(
  {
    server_conflict_id: column.text,
    sale_id: column.text,
    shift_id: column.text,
    type: column.text,
    severity: column.text,
    status: column.text,
    details: column.text,
    /** Joined display values; kept even when the receipt is not local. */
    sale_receipt_number: column.text,
    shift_number: column.text,
    created_at: isoText,
    resolved_at: isoText,
  },
  {
    localOnly: true,
    indexes: {
      sync_conflict_local_status: ['status'],
      sync_conflict_local_sale: ['sale_id'],
      sync_conflict_local_severity: ['severity'],
    },
  },
)

export const PosSchema = new Schema({
  product,
  barcode,
  brand,
  product_price: productPrice,
  stock_level: stockLevel,
  customer,
  credit_profile: creditProfile,
  loyalty_account: loyaltyAccount,
  loyalty_lot: loyaltyLot,
  pos_config: posConfig,
  pos_session: posSession,
  staff_binding: staffBinding,
  shift,
  sale,
  sale_line: saleLine,
  sale_tender: saleTender,
  cash_movement: cashMovement,
  credit_repayment: creditRepayment,
  cart_draft: cartDraft,
  cart_draft_line: cartDraftLine,
  cart_tender: cartTender,
  held_cart: heldCart,
  held_cart_line: heldCartLine,
  cart_void: cartVoid,
  refund,
  refund_line: refundLine,
  refund_tender: refundTender,
  shift_report: shiftReport,
  customer_draft: customerDraft,
  outbox,
  local_stock_delta: localStockDelta,
  local_credit_delta: localCreditDelta,
  local_loyalty_delta: localLoyaltyDelta,
  document_sequence: documentSequence,
  device_setting: deviceSetting,
  sync_conflict_local: syncConflictLocal,
})

export type PosDatabase = (typeof PosSchema)['types']

/** Tables that come from the server (read-only on the device). */
export const SYNCED_TABLES = [
  'product',
  'barcode',
  'brand',
  'product_price',
  'stock_level',
  'customer',
  'credit_profile',
  'loyalty_account',
  'loyalty_lot',
] as const

export type SyncedTable = (typeof SYNCED_TABLES)[number]
