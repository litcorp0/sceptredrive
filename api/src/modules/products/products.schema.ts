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
import { brand, category, uom } from '../catalog/catalog.schema.ts'
import { branch } from '../org/branches.schema.ts'

export const taxCategoryEnum = pgEnum('tax_category', ['STANDARD', 'ZERO_RATED', 'EXEMPT'])

export const product = pgTable(
  'product',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sku: text('sku').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => category.id, { onDelete: 'restrict' }),
    brandId: uuid('brand_id').references(() => brand.id, { onDelete: 'set null' }),
    uomId: uuid('uom_id')
      .notNull()
      .references(() => uom.id, { onDelete: 'restrict' }),
    costPriceMinor: integer('cost_price_minor').notNull().default(0),
    basePriceMinor: integer('base_price_minor').notNull(),
    taxCategory: taxCategoryEnum('tax_category').notNull().default('STANDARD'),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('product_sku_unique').on(table.sku),
    index('product_name_trgm_idx').using('gin', sql`${table.name} gin_trgm_ops`),
    index('product_category_idx').on(table.categoryId),
    index('product_brand_idx').on(table.brandId),
    index('product_uom_idx').on(table.uomId),
    index('product_active_idx').on(table.isActive),
  ],
)

export const barcode = pgTable(
  'barcode',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('barcode_code_unique').on(table.code),
    index('barcode_product_idx').on(table.productId),
  ],
)

export const productPrice = pgTable(
  'product_price',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id, { onDelete: 'restrict' }),
    priceMinor: integer('price_minor').notNull(),
    updatedBy: text('updated_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('product_price_product_branch_unique').on(table.productId, table.branchId),
    index('product_price_branch_idx').on(table.branchId),
  ],
)
