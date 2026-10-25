CREATE TYPE "public"."approval_reason_code" AS ENUM('OVER_THRESHOLD', 'PRICE_TOO_HIGH', 'OUT_OF_POLICY', 'INCOMPLETE', 'DUPLICATE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');--> statement-breakpoint
CREATE TYPE "public"."approval_type" AS ENUM('PURCHASE_ORDER', 'PRODUCT_CREATE', 'TRANSFER_REQUEST', 'STOCK_WRITE_OFF', 'PRICE_CHANGE', 'CREDIT_LIMIT_CHANGE', 'SHIFT_VARIANCE_REVIEW', 'REFUND');--> statement-breakpoint
CREATE TYPE "public"."over_receipt_reason" AS ENUM('SUPPLIER_SENT_MORE', 'ORDER_ROUNDING', 'SUBSTITUTE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."invoice_match_status" AS ENUM('UNMATCHED', 'MATCHED', 'PRICE_VARIANCE', 'QUANTITY_VARIANCE', 'PRICE_AND_QUANTITY_VARIANCE', 'NOT_ON_ORDER');--> statement-breakpoint
CREATE TYPE "public"."purchase_order_status" AS ENUM('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."supplier_return_status" AS ENUM('DRAFT', 'POSTED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "approval" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "approval_type" NOT NULL,
	"entity_id" uuid,
	"branch_id" uuid NOT NULL,
	"status" "approval_status" DEFAULT 'PENDING' NOT NULL,
	"requested_by" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_note" text,
	"amount_minor" integer,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decision_reason_code" "approval_reason_code",
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "document_sequence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"period" text NOT NULL,
	"value" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "purchase_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"status" "purchase_order_status" DEFAULT 'DRAFT' NOT NULL,
	"expected_date" date,
	"note" text,
	"requested_by" text NOT NULL,
	"approval_id" uuid,
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"sent_by" text,
	"closed_at" timestamp with time zone,
	"closed_by" text,
	"close_note" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	"cancel_reason" text,
	"idempotency_key" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "purchase_order_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"unit_cost_minor" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "supplier_credit_note" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"return_id" uuid NOT NULL,
	"amount_minor" integer NOT NULL,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "supplier_return" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"purchase_order_id" uuid,
	"receipt_id" uuid,
	"status" "supplier_return_status" DEFAULT 'DRAFT' NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"credit_note_number" text,
	"supplier_credit_note_number" text,
	"posted_at" timestamp with time zone,
	"posted_by" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	"cancel_reason" text,
	"idempotency_key" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "supplier_return_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_id" uuid NOT NULL,
	"receipt_line_id" uuid NOT NULL,
	"purchase_order_line_id" uuid,
	"product_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"unit_cost_minor" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "stock_receipt" ADD COLUMN "purchase_order_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_receipt" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "stock_receipt_line" ADD COLUMN "purchase_order_line_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_receipt_line" ADD COLUMN "over_receipt_reason" "over_receipt_reason";--> statement-breakpoint
ALTER TABLE "stock_receipt_line" ADD COLUMN "over_receipt_note" text;--> statement-breakpoint
ALTER TABLE "stock_threshold" ADD COLUMN "max_quantity" integer;--> statement-breakpoint
ALTER TABLE "stock_threshold" ADD COLUMN "min_order_quantity" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Backfill (P11-D3): existing thresholds keep working with a max of twice the
-- minimum. New rows get the same default from the service.
UPDATE "stock_threshold" SET "max_quantity" = "threshold" * 2 WHERE "max_quantity" IS NULL;--> statement-breakpoint
ALTER TABLE "supplier_invoice" ADD COLUMN "purchase_order_id" uuid;--> statement-breakpoint
ALTER TABLE "supplier_invoice_line" ADD COLUMN "purchase_order_line_id" uuid;--> statement-breakpoint
ALTER TABLE "supplier_invoice_line" ADD COLUMN "match_status" "invoice_match_status" DEFAULT 'UNMATCHED' NOT NULL;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_sequence" ADD CONSTRAINT "document_sequence_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_approval_id_approval_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approval"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_line" ADD CONSTRAINT "purchase_order_line_order_id_purchase_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."purchase_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_line" ADD CONSTRAINT "purchase_order_line_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_credit_note" ADD CONSTRAINT "supplier_credit_note_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_credit_note" ADD CONSTRAINT "supplier_credit_note_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_credit_note" ADD CONSTRAINT "supplier_credit_note_return_id_supplier_return_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."supplier_return"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return" ADD CONSTRAINT "supplier_return_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return" ADD CONSTRAINT "supplier_return_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return" ADD CONSTRAINT "supplier_return_purchase_order_id_purchase_order_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return" ADD CONSTRAINT "supplier_return_receipt_id_stock_receipt_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."stock_receipt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_line" ADD CONSTRAINT "supplier_return_line_return_id_supplier_return_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."supplier_return"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_line" ADD CONSTRAINT "supplier_return_line_receipt_line_id_stock_receipt_line_id_fk" FOREIGN KEY ("receipt_line_id") REFERENCES "public"."stock_receipt_line"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_line" ADD CONSTRAINT "supplier_return_line_purchase_order_line_id_purchase_order_line_id_fk" FOREIGN KEY ("purchase_order_line_id") REFERENCES "public"."purchase_order_line"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_line" ADD CONSTRAINT "supplier_return_line_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approval_open_entity_unique" ON "approval" USING btree ("type","entity_id") WHERE "approval"."status" = 'PENDING' and "approval"."entity_id" is not null;--> statement-breakpoint
CREATE INDEX "approval_branch_status_requested_idx" ON "approval" USING btree ("branch_id","status","requested_at");--> statement-breakpoint
CREATE INDEX "approval_type_status_idx" ON "approval" USING btree ("type","status");--> statement-breakpoint
CREATE UNIQUE INDEX "document_sequence_branch_kind_period_unique" ON "document_sequence" USING btree ("branch_id","kind","period");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_order_number_unique" ON "purchase_order" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_order_idempotency_unique" ON "purchase_order" USING btree ("branch_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "purchase_order_branch_status_created_idx" ON "purchase_order" USING btree ("branch_id","status","created_at");--> statement-breakpoint
CREATE INDEX "purchase_order_supplier_status_idx" ON "purchase_order" USING btree ("supplier_id","status");--> statement-breakpoint
CREATE INDEX "purchase_order_expected_date_idx" ON "purchase_order" USING btree ("expected_date");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_order_line_number_unique" ON "purchase_order_line" USING btree ("order_id","line_number");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_order_line_product_unique" ON "purchase_order_line" USING btree ("order_id","product_id");--> statement-breakpoint
CREATE INDEX "purchase_order_line_product_idx" ON "purchase_order_line" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_credit_note_number_unique" ON "supplier_credit_note" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_credit_note_return_unique" ON "supplier_credit_note" USING btree ("return_id");--> statement-breakpoint
CREATE INDEX "supplier_credit_note_branch_posted_idx" ON "supplier_credit_note" USING btree ("branch_id","posted_at");--> statement-breakpoint
CREATE INDEX "supplier_credit_note_supplier_idx" ON "supplier_credit_note" USING btree ("supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_return_number_unique" ON "supplier_return" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_return_idempotency_unique" ON "supplier_return" USING btree ("branch_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "supplier_return_branch_status_created_idx" ON "supplier_return" USING btree ("branch_id","status","created_at");--> statement-breakpoint
CREATE INDEX "supplier_return_supplier_created_idx" ON "supplier_return" USING btree ("supplier_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_return_line_receipt_line_unique" ON "supplier_return_line" USING btree ("return_id","receipt_line_id");--> statement-breakpoint
CREATE INDEX "supplier_return_line_receipt_line_idx" ON "supplier_return_line" USING btree ("receipt_line_id");--> statement-breakpoint
CREATE INDEX "supplier_return_line_product_idx" ON "supplier_return_line" USING btree ("product_id");--> statement-breakpoint
ALTER TABLE "supplier_invoice" ADD CONSTRAINT "supplier_invoice_purchase_order_id_purchase_order_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_line" ADD CONSTRAINT "supplier_invoice_line_purchase_order_line_id_purchase_order_line_id_fk" FOREIGN KEY ("purchase_order_line_id") REFERENCES "public"."purchase_order_line"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_receipt_idempotency_unique" ON "stock_receipt" USING btree ("branch_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "stock_receipt_purchase_order_idx" ON "stock_receipt" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE INDEX "stock_receipt_line_purchase_order_line_idx" ON "stock_receipt_line" USING btree ("purchase_order_line_id");--> statement-breakpoint
CREATE INDEX "supplier_invoice_purchase_order_idx" ON "supplier_invoice" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE INDEX "supplier_invoice_line_purchase_order_line_idx" ON "supplier_invoice_line" USING btree ("purchase_order_line_id");
