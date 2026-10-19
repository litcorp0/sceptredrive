import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { product } from '../products/products.schema.ts'

export const supplierStatusEnum = pgEnum('supplier_status', ['ACTIVE', 'ARCHIVED'])

export const supplierPaymentDetailMethodEnum = pgEnum('supplier_payment_detail_method', [
  'BANK',
  'MOMO',
])

/** Paystack Ghana mobile-money telco codes (documented values). */
export const supplierMomoNetworkEnum = pgEnum('supplier_momo_network', ['MTN', 'VOD', 'ATL'])

/** Global supplier master; archived suppliers stay readable but take no new documents. */
export const supplier = pgTable(
  'supplier',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    contactName: text('contact_name'),
    phone: text('phone'),
    email: text('email'),
    address: text('address'),
    tin: text('tin'),
    vatNumber: text('vat_number'),
    paymentTermDays: integer('payment_term_days').notNull().default(0),
    notes: text('notes'),
    status: supplierStatusEnum('status').notNull().default('ACTIVE'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('supplier_code_unique').on(table.code),
    index('supplier_name_trgm_idx').using('gin', sql`${table.name} gin_trgm_ops`),
    index('supplier_status_idx').on(table.status),
  ],
)

/**
 * Bank / MoMo destinations for paying a supplier. Exactly one active default per
 * supplier (partial unique index); deactivate, never delete. `paystackRecipientCode`
 * is reserved for the Phase 8 transfer flow.
 */
export const supplierPaymentDetail = pgTable(
  'supplier_payment_detail',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => supplier.id, { onDelete: 'restrict' }),
    method: supplierPaymentDetailMethodEnum('method').notNull(),
    label: text('label'),
    accountName: text('account_name'),
    accountNumber: text('account_number'),
    bankName: text('bank_name'),
    bankCode: text('bank_code'),
    momoNetwork: supplierMomoNetworkEnum('momo_network'),
    phone: text('phone'),
    isDefault: boolean('is_default').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    paystackRecipientCode: text('paystack_recipient_code'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('supplier_payment_detail_account_unique').on(
      table.supplierId,
      table.method,
      table.accountNumber,
    ),
    uniqueIndex('supplier_payment_detail_default_unique')
      .on(table.supplierId)
      .where(sql`${table.isDefault} and ${table.isActive}`),
    index('supplier_payment_detail_supplier_idx').on(table.supplierId),
  ],
)

/**
 * Which supplier sells which product: supplier SKU, lead time, and the last cost
 * observed on a recorded invoice line (projection). At most one preferred supplier
 * per product (partial unique index).
 */
export const supplierProduct = pgTable(
  'supplier_product',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => supplier.id, { onDelete: 'restrict' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'restrict' }),
    supplierSku: text('supplier_sku'),
    leadTimeDays: integer('lead_time_days'),
    lastCostMinor: integer('last_cost_minor').notNull().default(0),
    lastCostAt: timestamp('last_cost_at', { withTimezone: true }),
    isPreferred: boolean('is_preferred').notNull().default(false),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('supplier_product_supplier_product_unique').on(table.supplierId, table.productId),
    uniqueIndex('supplier_product_preferred_unique')
      .on(table.productId)
      .where(sql`${table.isPreferred}`),
    index('supplier_product_product_idx').on(table.productId),
  ],
)
