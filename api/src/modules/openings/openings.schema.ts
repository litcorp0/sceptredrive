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
import { brand, category, uom } from '../catalog/catalog.schema.ts'
import { stockMovement } from '../inventory/inventory.schema.ts'
import { branch } from '../org/branches.schema.ts'
import { product, taxCategoryEnum } from '../products/products.schema.ts'

/**
 * A go-live opening document (Phase 19).
 *
 * It is a **count**, not a receipt: the lines hold what the shelf holds and the post
 * computes the delta against `stock_level` at that moment. `DRAFT` may be deleted and
 * re-imported; `POSTED` is immutable and its corrections are compensating movements.
 *
 * A new product does not exist when the manager drafts the file, so
 * `stock_opening_line.product_id` is nullable and the line keeps the catalogue snapshot
 * the admin will create at post time.
 */
export const stockOpeningStatusEnum = pgEnum('stock_opening_status', ['DRAFT', 'POSTED'])

export const stockOpening = pgTable(
  'stock_opening',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    number: text('number').notNull(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id, { onDelete: 'restrict' }),
    status: stockOpeningStatusEnum('status').notNull().default('DRAFT'),
    /** When the shelf was counted. Distinct from `posted_at`, when the ledger moved. */
    countedAt: timestamp('counted_at', { withTimezone: true }).notNull(),
    note: text('note'),
    idempotencyKey: text('idempotency_key'),
    lineCount: integer('line_count').notNull().default(0),
    newProductCount: integer('new_product_count').notNull().default(0),
    totalUnits: integer('total_units').notNull().default(0),
    /** Σ counted quantity × stated cost, the inventory value the count represents. */
    countedValueMinor: integer('counted_value_minor').notNull().default(0),
    /** Σ positive delta × stated cost, what this document actually added to the ledger. */
    postedValueMinor: integer('posted_value_minor').notNull().default(0),
    uncostedLineCount: integer('uncosted_line_count').notNull().default(0),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    postedBy: text('posted_by'),
    postedAt: timestamp('posted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('stock_opening_number_unique').on(table.number),
    uniqueIndex('stock_opening_branch_idempotency_unique').on(table.branchId, table.idempotencyKey),
    index('stock_opening_branch_status_created_idx').on(
      table.branchId,
      table.status,
      table.createdAt,
    ),
  ],
)

export const stockOpeningLine = pgTable(
  'stock_opening_line',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    openingId: uuid('opening_id')
      .notNull()
      .references(() => stockOpening.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    /** Null while the line is a new product that only exists after the admin posts. */
    productId: uuid('product_id').references(() => product.id, { onDelete: 'restrict' }),
    isNew: boolean('is_new').notNull().default(false),
    /** Catalogue snapshot; used to create the product when `product_id` is null. */
    sku: text('sku'),
    name: text('name').notNull(),
    categoryId: uuid('category_id').references(() => category.id, { onDelete: 'restrict' }),
    uomId: uuid('uom_id').references(() => uom.id, { onDelete: 'restrict' }),
    brandId: uuid('brand_id').references(() => brand.id, { onDelete: 'set null' }),
    barcode: text('barcode'),
    basePriceMinor: integer('base_price_minor'),
    taxCategory: taxCategoryEnum('tax_category'),
    /** What the shelf held at the count. */
    quantity: integer('quantity').notNull(),
    unitCostMinor: integer('unit_cost_minor').notNull(),
    /** The review snapshot; post recomputes both and refuses a negative delta. */
    onHandAtDraft: integer('on_hand_at_draft').notNull().default(0),
    deltaAtDraft: integer('delta_at_draft').notNull().default(0),
    warning: text('warning'),
    movementId: uuid('movement_id').references(() => stockMovement.id, { onDelete: 'restrict' }),
  },
  (table) => [
    uniqueIndex('stock_opening_line_opening_line_no_unique').on(table.openingId, table.lineNo),
    index('stock_opening_line_opening_idx').on(table.openingId),
    index('stock_opening_line_product_idx').on(table.productId),
  ],
)
