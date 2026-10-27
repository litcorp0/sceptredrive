CREATE TYPE "public"."payment_method" AS ENUM('MOMO', 'CARD', 'BANK_TRANSFER');--> statement-breakpoint
CREATE TYPE "public"."payment_provider" AS ENUM('PAYSTACK', 'MOCK');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('PENDING', 'PAID', 'FAILED', 'ABANDONED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."cart_void_reason" AS ENUM('CUSTOMER_CHANGED_MIND', 'WRONG_ITEM', 'PRICE_DISPUTE', 'DUPLICATE_SCAN', 'CUSTOMER_LEFT', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."refund_reason" AS ENUM('CUSTOMER_CHANGED_MIND', 'WRONG_ITEM', 'DEFECTIVE', 'PRICE_DISPUTE', 'DUPLICATE_SALE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."refund_restock" AS ENUM('RESALABLE', 'DAMAGED', 'NOT_RETURNED');--> statement-breakpoint
CREATE TYPE "public"."refund_tender_status" AS ENUM('SETTLED', 'PENDING', 'FAILED', 'NEEDS_ATTENTION');--> statement-breakpoint
CREATE TABLE "payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"terminal_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"client_payment_id" uuid NOT NULL,
	"cashier_user_id" text NOT NULL,
	"cashier_staff_id" text NOT NULL,
	"method" "payment_method" NOT NULL,
	"amount_minor" integer NOT NULL,
	"provider" "payment_provider" NOT NULL,
	"provider_reference" text NOT NULL,
	"provider_email" text NOT NULL,
	"provider_transaction_id" text,
	"status" "payment_status" DEFAULT 'PENDING' NOT NULL,
	"channel" text,
	"display_text" text,
	"authorization_url" text,
	"account_number" text,
	"account_name" text,
	"account_bank" text,
	"expires_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"failed_code" text,
	"failed_message" text,
	"orphaned" boolean DEFAULT false NOT NULL,
	"last_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "payment_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "payment_provider" NOT NULL,
	"event_type" text NOT NULL,
	"body_sha256" text NOT NULL,
	"provider_reference" text,
	"payment_id" uuid,
	"status" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);--> statement-breakpoint
CREATE TABLE "cart_void" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"terminal_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"cashier_user_id" text NOT NULL,
	"cashier_staff_id" text NOT NULL,
	"reason_code" "cart_void_reason" NOT NULL,
	"note" text,
	"item_count" integer DEFAULT 0 NOT NULL,
	"gross_minor" integer DEFAULT 0 NOT NULL,
	"label" text,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "refund" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"sale_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"terminal_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"customer_id" uuid,
	"reason_code" "refund_reason" NOT NULL,
	"note" text,
	"refunded_minor" integer NOT NULL,
	"base_minor" integer DEFAULT 0 NOT NULL,
	"vat_minor" integer DEFAULT 0 NOT NULL,
	"nhil_minor" integer DEFAULT 0 NOT NULL,
	"getfund_minor" integer DEFAULT 0 NOT NULL,
	"tax_total_minor" integer DEFAULT 0 NOT NULL,
	"approved_by_user_id" text NOT NULL,
	"approved_by_staff_id" text NOT NULL,
	"approval_pin_version" integer NOT NULL,
	"approval_reason_code" text NOT NULL,
	"approved_at" timestamp with time zone NOT NULL,
	"approval_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "refund_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"refund_id" uuid NOT NULL,
	"sale_line_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_minor" integer NOT NULL,
	"unit_cost_minor" integer DEFAULT 0 NOT NULL,
	"restock" "refund_restock" NOT NULL,
	"damage_reason" text,
	"base_minor" integer DEFAULT 0 NOT NULL,
	"vat_minor" integer DEFAULT 0 NOT NULL,
	"nhil_minor" integer DEFAULT 0 NOT NULL,
	"getfund_minor" integer DEFAULT 0 NOT NULL,
	"tax_total_minor" integer DEFAULT 0 NOT NULL,
	"total_minor" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "refund_tender" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"refund_id" uuid NOT NULL,
	"sequence" integer DEFAULT 1 NOT NULL,
	"method" "sale_tender_method" NOT NULL,
	"amount_minor" integer NOT NULL,
	"sale_tender_id" uuid NOT NULL,
	"payment_id" uuid,
	"provider_refund_reference" text,
	"status" "refund_tender_status" DEFAULT 'SETTLED' NOT NULL,
	"settled_at" timestamp with time zone,
	"failed_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "shift_report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shift_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"terminal_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"number" text NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone NOT NULL,
	"opening_float_minor" integer DEFAULT 0 NOT NULL,
	"sale_count" integer DEFAULT 0 NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"refund_count" integer DEFAULT 0 NOT NULL,
	"void_count" integer DEFAULT 0 NOT NULL,
	"gross_minor" integer DEFAULT 0 NOT NULL,
	"refund_minor" integer DEFAULT 0 NOT NULL,
	"net_minor" integer DEFAULT 0 NOT NULL,
	"line_discount_minor" integer DEFAULT 0 NOT NULL,
	"sale_discount_minor" integer DEFAULT 0 NOT NULL,
	"loyalty_discount_minor" integer DEFAULT 0 NOT NULL,
	"loyalty_redeem_points" integer DEFAULT 0 NOT NULL,
	"loyalty_earned_points" integer DEFAULT 0 NOT NULL,
	"base_minor" integer DEFAULT 0 NOT NULL,
	"vat_minor" integer DEFAULT 0 NOT NULL,
	"nhil_minor" integer DEFAULT 0 NOT NULL,
	"getfund_minor" integer DEFAULT 0 NOT NULL,
	"tax_total_minor" integer DEFAULT 0 NOT NULL,
	"cash_minor" integer DEFAULT 0 NOT NULL,
	"credit_minor" integer DEFAULT 0 NOT NULL,
	"momo_minor" integer DEFAULT 0 NOT NULL,
	"card_minor" integer DEFAULT 0 NOT NULL,
	"bank_transfer_minor" integer DEFAULT 0 NOT NULL,
	"change_minor" integer DEFAULT 0 NOT NULL,
	"cash_in_minor" integer DEFAULT 0 NOT NULL,
	"cash_out_minor" integer DEFAULT 0 NOT NULL,
	"expected_cash_minor" integer DEFAULT 0 NOT NULL,
	"counted_cash_minor" integer DEFAULT 0 NOT NULL,
	"variance_minor" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DROP INDEX "sale_tender_sale_method_unique";--> statement-breakpoint
ALTER TABLE "sale_tender" ADD COLUMN "sequence" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_tender" ADD COLUMN "payment_id" uuid;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_terminal_id_terminal_id_fk" FOREIGN KEY ("terminal_id") REFERENCES "public"."terminal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_event" ADD CONSTRAINT "payment_event_payment_id_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_void" ADD CONSTRAINT "cart_void_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_void" ADD CONSTRAINT "cart_void_terminal_id_terminal_id_fk" FOREIGN KEY ("terminal_id") REFERENCES "public"."terminal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_void" ADD CONSTRAINT "cart_void_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_void" ADD CONSTRAINT "cart_void_shift_id_shift_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shift"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_sale_id_sale_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sale"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_terminal_id_terminal_id_fk" FOREIGN KEY ("terminal_id") REFERENCES "public"."terminal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_shift_id_shift_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shift"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_approval_id_approval_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approval"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_line" ADD CONSTRAINT "refund_line_refund_id_refund_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."refund"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_line" ADD CONSTRAINT "refund_line_sale_line_id_sale_line_id_fk" FOREIGN KEY ("sale_line_id") REFERENCES "public"."sale_line"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_line" ADD CONSTRAINT "refund_line_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_tender" ADD CONSTRAINT "refund_tender_refund_id_refund_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."refund"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_tender" ADD CONSTRAINT "refund_tender_sale_tender_id_sale_tender_id_fk" FOREIGN KEY ("sale_tender_id") REFERENCES "public"."sale_tender"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_tender" ADD CONSTRAINT "refund_tender_payment_id_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_report" ADD CONSTRAINT "shift_report_shift_id_shift_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shift"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_report" ADD CONSTRAINT "shift_report_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_report" ADD CONSTRAINT "shift_report_terminal_id_terminal_id_fk" FOREIGN KEY ("terminal_id") REFERENCES "public"."terminal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_report" ADD CONSTRAINT "shift_report_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_terminal_client_unique" ON "payment" USING btree ("terminal_id","client_payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_provider_reference_unique" ON "payment" USING btree ("provider_reference");--> statement-breakpoint
CREATE INDEX "payment_branch_created_idx" ON "payment" USING btree ("branch_id","created_at");--> statement-breakpoint
CREATE INDEX "payment_status_created_idx" ON "payment" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "payment_shift_idx" ON "payment" USING btree ("shift_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_event_body_unique" ON "payment_event" USING btree ("provider","body_sha256");--> statement-breakpoint
CREATE INDEX "payment_event_payment_idx" ON "payment_event" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "payment_event_type_received_idx" ON "payment_event" USING btree ("event_type","received_at");--> statement-breakpoint
CREATE INDEX "cart_void_branch_occurred_idx" ON "cart_void" USING btree ("branch_id","occurred_at");--> statement-breakpoint
CREATE INDEX "cart_void_terminal_occurred_idx" ON "cart_void" USING btree ("terminal_id","occurred_at");--> statement-breakpoint
CREATE INDEX "cart_void_reason_idx" ON "cart_void" USING btree ("reason_code");--> statement-breakpoint
CREATE UNIQUE INDEX "refund_number_unique" ON "refund" USING btree ("number");--> statement-breakpoint
CREATE INDEX "refund_sale_idx" ON "refund" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "refund_branch_occurred_idx" ON "refund" USING btree ("branch_id","occurred_at");--> statement-breakpoint
CREATE INDEX "refund_shift_idx" ON "refund" USING btree ("shift_id");--> statement-breakpoint
CREATE UNIQUE INDEX "refund_line_refund_number_unique" ON "refund_line" USING btree ("refund_id","line_number");--> statement-breakpoint
CREATE INDEX "refund_line_sale_line_idx" ON "refund_line" USING btree ("sale_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "refund_tender_refund_sequence_unique" ON "refund_tender" USING btree ("refund_id","sequence");--> statement-breakpoint
CREATE INDEX "refund_tender_sale_tender_idx" ON "refund_tender" USING btree ("sale_tender_id");--> statement-breakpoint
CREATE INDEX "refund_tender_provider_reference_idx" ON "refund_tender" USING btree ("provider_refund_reference");--> statement-breakpoint
CREATE UNIQUE INDEX "shift_report_shift_unique" ON "shift_report" USING btree ("shift_id");--> statement-breakpoint
CREATE INDEX "shift_report_branch_closed_idx" ON "shift_report" USING btree ("branch_id","closed_at");--> statement-breakpoint
ALTER TABLE "sale_tender" ADD CONSTRAINT "sale_tender_payment_id_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sale_tender_sale_sequence_unique" ON "sale_tender" USING btree ("sale_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "sale_tender_payment_unique" ON "sale_tender" USING btree ("payment_id") WHERE "sale_tender"."payment_id" is not null;--> statement-breakpoint
CREATE INDEX "sale_tender_payment_idx" ON "sale_tender" USING btree ("payment_id");
