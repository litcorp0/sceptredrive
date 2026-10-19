CREATE TYPE "public"."supplier_allocation_kind" AS ENUM('APPLY', 'RELEASE');--> statement-breakpoint
CREATE TYPE "public"."supplier_invoice_status" AS ENUM('OPEN', 'PARTIAL', 'PAID', 'VOID');--> statement-breakpoint
CREATE TYPE "public"."supplier_invoice_void_reason" AS ENUM('DUPLICATE', 'CANCELLED', 'ERROR', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."supplier_payment_method" AS ENUM('CASH', 'BANK', 'MOMO');--> statement-breakpoint
CREATE TYPE "public"."supplier_payment_status" AS ENUM('COMPLETED', 'VOID');--> statement-breakpoint
CREATE TYPE "public"."supplier_payment_void_reason" AS ENUM('DUPLICATE', 'ERROR', 'RETURNED', 'BANK_REVERSAL', 'OTHER');--> statement-breakpoint
CREATE TABLE "supplier_invoice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"supplier_invoice_number" text NOT NULL,
	"invoice_date" date NOT NULL,
	"due_date" date NOT NULL,
	"receipt_id" uuid,
	"subtotal_minor" integer NOT NULL,
	"vat_minor" integer DEFAULT 0 NOT NULL,
	"nhil_minor" integer DEFAULT 0 NOT NULL,
	"getfund_minor" integer DEFAULT 0 NOT NULL,
	"total_minor" integer NOT NULL,
	"amount_paid_minor" integer DEFAULT 0 NOT NULL,
	"status" "supplier_invoice_status" DEFAULT 'OPEN' NOT NULL,
	"void_reason" "supplier_invoice_void_reason",
	"voided_by" text,
	"voided_at" timestamp with time zone,
	"note" text,
	"idempotency_key" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_invoice_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"product_id" uuid,
	"description" text,
	"quantity" integer NOT NULL,
	"unit_cost_minor" integer NOT NULL,
	"line_total_minor" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"method" "supplier_payment_method" NOT NULL,
	"amount_minor" integer NOT NULL,
	"reference" text,
	"paid_at" timestamp with time zone NOT NULL,
	"payment_detail_id" uuid,
	"status" "supplier_payment_status" DEFAULT 'COMPLETED' NOT NULL,
	"void_reason" "supplier_payment_void_reason",
	"voided_by" text,
	"voided_at" timestamp with time zone,
	"note" text,
	"idempotency_key" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_payment_allocation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"kind" "supplier_allocation_kind" NOT NULL,
	"amount_minor" integer NOT NULL,
	"reverses_allocation_id" uuid,
	"note" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stock_receipt" ADD COLUMN "supplier_id" uuid;--> statement-breakpoint
ALTER TABLE "supplier_invoice" ADD CONSTRAINT "supplier_invoice_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice" ADD CONSTRAINT "supplier_invoice_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice" ADD CONSTRAINT "supplier_invoice_receipt_id_stock_receipt_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."stock_receipt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_line" ADD CONSTRAINT "supplier_invoice_line_invoice_id_supplier_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."supplier_invoice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_line" ADD CONSTRAINT "supplier_invoice_line_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payment" ADD CONSTRAINT "supplier_payment_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payment" ADD CONSTRAINT "supplier_payment_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payment" ADD CONSTRAINT "supplier_payment_payment_detail_id_supplier_payment_detail_id_fk" FOREIGN KEY ("payment_detail_id") REFERENCES "public"."supplier_payment_detail"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payment_allocation" ADD CONSTRAINT "supplier_payment_allocation_payment_id_supplier_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."supplier_payment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payment_allocation" ADD CONSTRAINT "supplier_payment_allocation_invoice_id_supplier_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."supplier_invoice"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payment_allocation" ADD CONSTRAINT "supplier_payment_allocation_reverses_allocation_id_supplier_payment_allocation_id_fk" FOREIGN KEY ("reverses_allocation_id") REFERENCES "public"."supplier_payment_allocation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_invoice_number_unique" ON "supplier_invoice" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_invoice_idempotency_unique" ON "supplier_invoice" USING btree ("branch_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_invoice_supplier_number_unique" ON "supplier_invoice" USING btree ("supplier_id","branch_id","supplier_invoice_number") WHERE "supplier_invoice"."status" <> 'VOID';--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_invoice_receipt_unique" ON "supplier_invoice" USING btree ("receipt_id") WHERE "supplier_invoice"."receipt_id" is not null;--> statement-breakpoint
CREATE INDEX "supplier_invoice_branch_status_due_idx" ON "supplier_invoice" USING btree ("branch_id","status","due_date");--> statement-breakpoint
CREATE INDEX "supplier_invoice_supplier_status_idx" ON "supplier_invoice" USING btree ("supplier_id","status");--> statement-breakpoint
CREATE INDEX "supplier_invoice_line_invoice_idx" ON "supplier_invoice_line" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_invoice_line_product_unique" ON "supplier_invoice_line" USING btree ("invoice_id","product_id") WHERE "supplier_invoice_line"."product_id" is not null;--> statement-breakpoint
CREATE INDEX "supplier_invoice_line_product_idx" ON "supplier_invoice_line" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_payment_number_unique" ON "supplier_payment" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_payment_idempotency_unique" ON "supplier_payment" USING btree ("branch_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "supplier_payment_supplier_paid_idx" ON "supplier_payment" USING btree ("supplier_id","paid_at");--> statement-breakpoint
CREATE INDEX "supplier_payment_branch_paid_idx" ON "supplier_payment" USING btree ("branch_id","paid_at");--> statement-breakpoint
CREATE INDEX "supplier_payment_status_idx" ON "supplier_payment" USING btree ("status");--> statement-breakpoint
CREATE INDEX "supplier_payment_allocation_payment_idx" ON "supplier_payment_allocation" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "supplier_payment_allocation_invoice_idx" ON "supplier_payment_allocation" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "supplier_payment_allocation_reverses_idx" ON "supplier_payment_allocation" USING btree ("reverses_allocation_id");--> statement-breakpoint
ALTER TABLE "stock_receipt" ADD CONSTRAINT "stock_receipt_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_receipt_supplier_idx" ON "stock_receipt" USING btree ("supplier_id");