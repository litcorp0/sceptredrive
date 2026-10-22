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
    pin_salt: column.text,
    pin_verifier: column.text,
    pin_version: minor,
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
    created_at: isoText,
  },
  { localOnly: true, indexes: { sale_shift: ['shift_id'], sale_occurred: ['occurred_at'] } },
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

export const saleTender = new Table(
  {
    sale_id: column.text,
    method: column.text,
    amount_minor: minor,
    reference: column.text,
    created_at: isoText,
  },
  { localOnly: true, indexes: { sale_tender_sale: ['sale_id'] } },
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
    last_error: column.text,
    server_result: column.text,
    created_at: isoText,
    updated_at: isoText,
  },
  {
    localOnly: true,
    indexes: {
      outbox_status_created: ['status', 'created_at'],
      outbox_transaction: ['client_transaction_id'],
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
    created_at: isoText,
    resolved_at: isoText,
  },
  {
    localOnly: true,
    indexes: {
      sync_conflict_local_status: ['status'],
      sync_conflict_local_sale: ['sale_id'],
    },
  },
)

export const PosSchema = new Schema({
  product,
  barcode,
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
  customer_draft: customerDraft,
  outbox,
  local_stock_delta: localStockDelta,
  local_credit_delta: localCreditDelta,
  local_loyalty_delta: localLoyaltyDelta,
  document_sequence: documentSequence,
  sync_conflict_local: syncConflictLocal,
})

export type PosDatabase = (typeof PosSchema)['types']

/** Tables that come from the server (read-only on the device). */
export const SYNCED_TABLES = [
  'product',
  'barcode',
  'product_price',
  'stock_level',
  'customer',
  'credit_profile',
  'loyalty_account',
  'loyalty_lot',
] as const

export type SyncedTable = (typeof SYNCED_TABLES)[number]
