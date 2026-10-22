CREATE TYPE "public"."cash_movement_type" AS ENUM('CASH_IN', 'CASH_OUT');--> statement-breakpoint
CREATE TYPE "public"."pos_transaction_type" AS ENUM('SALE', 'SHIFT_OPEN', 'CASH_MOVEMENT', 'SHIFT_CLOSE');--> statement-breakpoint
CREATE TYPE "public"."sale_tender_method" AS ENUM('CASH', 'CREDIT');--> statement-breakpoint
CREATE TYPE "public"."shift_status" AS ENUM('OPEN', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."sync_conflict_severity" AS ENUM('LOW', 'MEDIUM', 'HIGH');--> statement-breakpoint
CREATE TYPE "public"."sync_conflict_status" AS ENUM('OPEN', 'RESOLVED', 'DISMISSED');--> statement-breakpoint
CREATE TYPE "public"."sync_conflict_type" AS ENUM('STOCK_OVERSELL', 'CREDIT_OVER_LIMIT', 'CREDIT_HOLD', 'LOYALTY_NEGATIVE', 'LOYALTY_RATE_CHANGED', 'PRICE_MISMATCH', 'TOTAL_MISMATCH', 'SHIFT_VARIANCE_MISMATCH', 'STALE_CREDENTIALS', 'OVERRIDE_INVALID', 'DUPLICATE_CUSTOMER', 'CLOCK_SKEW', 'INVALID_CUSTOMER', 'UNKNOWN_PRODUCT');--> statement-breakpoint
ALTER TYPE "public"."stock_movement_reference" ADD VALUE 'SALE';--> statement-breakpoint
ALTER TYPE "public"."stock_movement_type" ADD VALUE 'SALE';--> statement-breakpoint
CREATE TABLE "cash_movement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shift_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"terminal_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"type" "cash_movement_type" NOT NULL,
	"amount_minor" integer NOT NULL,
	"reason" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"staff_user_id" text NOT NULL,
	"staff_staff_id" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "pos_staff_binding" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"staff_user_id" text NOT NULL,
	"staff_staff_id" text NOT NULL,
	"role" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"pin_version" integer NOT NULL,
	"binding_token_hash" text NOT NULL,
	"authorized_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pos_sync_transaction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"terminal_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"client_transaction_id" uuid NOT NULL,
	"type" "pos_transaction_type" NOT NULL,
	"status" text NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"conflict_count" integer DEFAULT 0 NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sale" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_number" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"terminal_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"client_transaction_id" uuid NOT NULL,
	"cashier_user_id" text NOT NULL,
	"cashier_staff_id" text NOT NULL,
	"customer_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"subtotal_minor" integer NOT NULL,
	"line_discount_minor" integer DEFAULT 0 NOT NULL,
	"sale_discount_minor" integer DEFAULT 0 NOT NULL,
	"loyalty_redeem_points" integer DEFAULT 0 NOT NULL,
	"loyalty_discount_minor" integer DEFAULT 0 NOT NULL,
	"vat_minor" integer DEFAULT 0 NOT NULL,
	"nhil_minor" integer DEFAULT 0 NOT NULL,
	"getfund_minor" integer DEFAULT 0 NOT NULL,
	"tax_total_minor" integer DEFAULT 0 NOT NULL,
	"total_minor" integer NOT NULL,
	"tender_total_minor" integer NOT NULL,
	"change_minor" integer DEFAULT 0 NOT NULL,
	"loyalty_earned_points" integer DEFAULT 0 NOT NULL,
	"credit_amount_minor" integer DEFAULT 0 NOT NULL,
	"tax_mode" text NOT NULL,
	"conflict_count" integer DEFAULT 0 NOT NULL,
	"app_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sale_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"barcode" text,
	"quantity" integer NOT NULL,
	"unit_price_minor" integer NOT NULL,
	"expected_unit_price_minor" integer NOT NULL,
	"line_discount_minor" integer DEFAULT 0 NOT NULL,
	"sale_discount_minor" integer DEFAULT 0 NOT NULL,
	"loyalty_discount_minor" integer DEFAULT 0 NOT NULL,
	"net_minor" integer NOT NULL,
	"taxable_minor" integer NOT NULL,
	"base_minor" integer NOT NULL,
	"vat_minor" integer NOT NULL,
	"nhil_minor" integer NOT NULL,
	"getfund_minor" integer NOT NULL,
	"tax_total_minor" integer NOT NULL,
	"total_minor" integer NOT NULL,
	"tax_category" text NOT NULL,
	"unit_cost_minor" integer DEFAULT 0 NOT NULL,
	"price_source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sale_tender" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_id" uuid NOT NULL,
	"method" "sale_tender_method" NOT NULL,
	"amount_minor" integer NOT NULL,
	"reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shift" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"terminal_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"cashier_user_id" text NOT NULL,
	"cashier_staff_id" text NOT NULL,
	"status" "shift_status" DEFAULT 'OPEN' NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"opening_float_minor" integer DEFAULT 0 NOT NULL,
	"counted_cash_minor" integer,
	"client_expected_cash_minor" integer,
	"server_expected_cash_minor" integer,
	"variance_minor" integer,
	"close_note" text,
	"opened_by" text,
	"closed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_conflict" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"terminal_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"sale_id" uuid,
	"shift_id" uuid,
	"type" "sync_conflict_type" NOT NULL,
	"severity" "sync_conflict_severity" NOT NULL,
	"status" "sync_conflict_status" DEFAULT 'OPEN' NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cash_movement" ADD CONSTRAINT "cash_movement_shift_id_shift_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shift"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movement" ADD CONSTRAINT "cash_movement_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movement" ADD CONSTRAINT "cash_movement_terminal_id_terminal_id_fk" FOREIGN KEY ("terminal_id") REFERENCES "public"."terminal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movement" ADD CONSTRAINT "cash_movement_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_staff_binding" ADD CONSTRAINT "pos_staff_binding_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_staff_binding" ADD CONSTRAINT "pos_staff_binding_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_sync_transaction" ADD CONSTRAINT "pos_sync_transaction_terminal_id_terminal_id_fk" FOREIGN KEY ("terminal_id") REFERENCES "public"."terminal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_sync_transaction" ADD CONSTRAINT "pos_sync_transaction_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale" ADD CONSTRAINT "sale_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale" ADD CONSTRAINT "sale_terminal_id_terminal_id_fk" FOREIGN KEY ("terminal_id") REFERENCES "public"."terminal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale" ADD CONSTRAINT "sale_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale" ADD CONSTRAINT "sale_shift_id_shift_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shift"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale" ADD CONSTRAINT "sale_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_line" ADD CONSTRAINT "sale_line_sale_id_sale_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sale"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_line" ADD CONSTRAINT "sale_line_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_tender" ADD CONSTRAINT "sale_tender_sale_id_sale_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sale"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift" ADD CONSTRAINT "shift_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift" ADD CONSTRAINT "shift_terminal_id_terminal_id_fk" FOREIGN KEY ("terminal_id") REFERENCES "public"."terminal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift" ADD CONSTRAINT "shift_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_conflict" ADD CONSTRAINT "sync_conflict_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_conflict" ADD CONSTRAINT "sync_conflict_terminal_id_terminal_id_fk" FOREIGN KEY ("terminal_id") REFERENCES "public"."terminal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_conflict" ADD CONSTRAINT "sync_conflict_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_conflict" ADD CONSTRAINT "sync_conflict_sale_id_sale_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sale"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_conflict" ADD CONSTRAINT "sync_conflict_shift_id_shift_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shift"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cash_movement_shift_occurred_idx" ON "cash_movement" USING btree ("shift_id","occurred_at");--> statement-breakpoint
CREATE INDEX "cash_movement_branch_occurred_idx" ON "cash_movement" USING btree ("branch_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_staff_binding_active_unique" ON "pos_staff_binding" USING btree ("device_id","staff_user_id") WHERE "pos_staff_binding"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "pos_staff_binding_device_staff_idx" ON "pos_staff_binding" USING btree ("device_id","staff_user_id");--> statement-breakpoint
CREATE INDEX "pos_staff_binding_staff_idx" ON "pos_staff_binding" USING btree ("staff_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_sync_transaction_client_unique" ON "pos_sync_transaction" USING btree ("terminal_id","client_transaction_id");--> statement-breakpoint
CREATE INDEX "pos_sync_transaction_terminal_applied_idx" ON "pos_sync_transaction" USING btree ("terminal_id","applied_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sale_receipt_number_unique" ON "sale" USING btree ("receipt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "sale_terminal_client_transaction_unique" ON "sale" USING btree ("terminal_id","client_transaction_id");--> statement-breakpoint
CREATE INDEX "sale_branch_occurred_idx" ON "sale" USING btree ("branch_id","occurred_at");--> statement-breakpoint
CREATE INDEX "sale_terminal_occurred_idx" ON "sale" USING btree ("terminal_id","occurred_at");--> statement-breakpoint
CREATE INDEX "sale_customer_occurred_idx" ON "sale" USING btree ("customer_id","occurred_at");--> statement-breakpoint
CREATE INDEX "sale_shift_idx" ON "sale" USING btree ("shift_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sale_line_sale_number_unique" ON "sale_line" USING btree ("sale_id","line_number");--> statement-breakpoint
CREATE INDEX "sale_line_sale_idx" ON "sale_line" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sale_line_product_idx" ON "sale_line" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "sale_tender_sale_idx" ON "sale_tender" USING btree ("sale_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sale_tender_sale_method_unique" ON "sale_tender" USING btree ("sale_id","method");--> statement-breakpoint
CREATE UNIQUE INDEX "shift_number_unique" ON "shift" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "shift_one_open_per_terminal" ON "shift" USING btree ("terminal_id") WHERE "shift"."status" = 'OPEN';--> statement-breakpoint
CREATE INDEX "shift_branch_opened_idx" ON "shift" USING btree ("branch_id","opened_at");--> statement-breakpoint
CREATE INDEX "shift_terminal_opened_idx" ON "shift" USING btree ("terminal_id","opened_at");--> statement-breakpoint
CREATE INDEX "sync_conflict_branch_status_idx" ON "sync_conflict" USING btree ("branch_id","status","severity");--> statement-breakpoint
CREATE INDEX "sync_conflict_terminal_created_idx" ON "sync_conflict" USING btree ("terminal_id","created_at");--> statement-breakpoint
CREATE INDEX "sync_conflict_sale_idx" ON "sync_conflict" USING btree ("sale_id");