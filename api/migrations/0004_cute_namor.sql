CREATE TYPE "public"."credit_entry_kind" AS ENUM('CHARGE', 'REPAYMENT', 'REFUND', 'ADJUSTMENT');--> statement-breakpoint
CREATE TYPE "public"."credit_method" AS ENUM('CASH', 'MOMO', 'BANK');--> statement-breakpoint
CREATE TYPE "public"."credit_override_reason" AS ENUM('TEMPORARY_APPROVAL', 'TRUSTED_CUSTOMER', 'URGENT_NEED', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."credit_reason_code" AS ENUM('SALE', 'OPENING_BALANCE', 'CORRECTION', 'WRITE_OFF', 'DISPUTE', 'RETURN', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."customer_status" AS ENUM('ACTIVE', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."loyalty_entry_kind" AS ENUM('EARN', 'REDEEM', 'CLAWBACK', 'ADJUST', 'EXPIRE');--> statement-breakpoint
CREATE TYPE "public"."loyalty_reason_code" AS ENUM('EXPIRY', 'RETURN', 'CORRECTION', 'GOODWILL', 'OTHER');--> statement-breakpoint
CREATE TABLE "credit_ledger_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"kind" "credit_entry_kind" NOT NULL,
	"amount_minor" integer NOT NULL,
	"reason_code" "credit_reason_code",
	"method" "credit_method",
	"note" text,
	"due_date" date,
	"reference_type" text,
	"reference_id" uuid,
	"reference_number" text,
	"override_reason" "credit_override_reason",
	"overridden_by" text,
	"received_by" text,
	"idempotency_key" text,
	"created_by" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"limit_minor" integer DEFAULT 0 NOT NULL,
	"hold" boolean DEFAULT false NOT NULL,
	"payment_term_days" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"balance_minor" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"address" text,
	"created_branch_id" uuid NOT NULL,
	"status" "customer_status" DEFAULT 'ACTIVE' NOT NULL,
	"anonymized_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loyalty_account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"balance_points" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loyalty_account_customer_id_unique" UNIQUE("customer_id")
);
--> statement-breakpoint
CREATE TABLE "loyalty_ledger_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"branch_id" uuid,
	"kind" "loyalty_entry_kind" NOT NULL,
	"points_delta" integer NOT NULL,
	"reason_code" "loyalty_reason_code",
	"note" text,
	"reference_type" text,
	"reference_id" uuid,
	"reference_number" text,
	"idempotency_key" text,
	"created_by" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loyalty_lot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"earn_entry_id" uuid NOT NULL,
	"points" integer NOT NULL,
	"remaining_points" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loyalty_lot_earn_entry_id_unique" UNIQUE("earn_entry_id")
);
--> statement-breakpoint
CREATE TABLE "loyalty_lot_consumption" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lot_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"points" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credit_ledger_entry" ADD CONSTRAINT "credit_ledger_entry_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger_entry" ADD CONSTRAINT "credit_ledger_entry_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_profile" ADD CONSTRAINT "credit_profile_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_profile" ADD CONSTRAINT "credit_profile_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_created_branch_id_branch_id_fk" FOREIGN KEY ("created_branch_id") REFERENCES "public"."branch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_account" ADD CONSTRAINT "loyalty_account_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_ledger_entry" ADD CONSTRAINT "loyalty_ledger_entry_account_id_loyalty_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."loyalty_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_ledger_entry" ADD CONSTRAINT "loyalty_ledger_entry_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_ledger_entry" ADD CONSTRAINT "loyalty_ledger_entry_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_lot" ADD CONSTRAINT "loyalty_lot_account_id_loyalty_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."loyalty_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_lot" ADD CONSTRAINT "loyalty_lot_earn_entry_id_loyalty_ledger_entry_id_fk" FOREIGN KEY ("earn_entry_id") REFERENCES "public"."loyalty_ledger_entry"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_lot_consumption" ADD CONSTRAINT "loyalty_lot_consumption_lot_id_loyalty_lot_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."loyalty_lot"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_lot_consumption" ADD CONSTRAINT "loyalty_lot_consumption_entry_id_loyalty_ledger_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."loyalty_ledger_entry"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_ledger_entry_customer_branch_idx" ON "credit_ledger_entry" USING btree ("customer_id","branch_id","occurred_at");--> statement-breakpoint
CREATE INDEX "credit_ledger_entry_branch_idx" ON "credit_ledger_entry" USING btree ("branch_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_ledger_entry_idempotency_unique" ON "credit_ledger_entry" USING btree ("branch_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_profile_customer_branch_unique" ON "credit_profile" USING btree ("customer_id","branch_id");--> statement-breakpoint
CREATE INDEX "credit_profile_branch_idx" ON "credit_profile" USING btree ("branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_phone_unique" ON "customer" USING btree ("phone") WHERE "customer"."anonymized_at" is null;--> statement-breakpoint
CREATE INDEX "customer_branch_idx" ON "customer" USING btree ("created_branch_id");--> statement-breakpoint
CREATE INDEX "customer_status_idx" ON "customer" USING btree ("status");--> statement-breakpoint
CREATE INDEX "loyalty_account_customer_idx" ON "loyalty_account" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "loyalty_ledger_entry_account_idx" ON "loyalty_ledger_entry" USING btree ("account_id","occurred_at");--> statement-breakpoint
CREATE INDEX "loyalty_ledger_entry_customer_idx" ON "loyalty_ledger_entry" USING btree ("customer_id","occurred_at");--> statement-breakpoint
CREATE INDEX "loyalty_ledger_entry_branch_idx" ON "loyalty_ledger_entry" USING btree ("branch_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "loyalty_ledger_entry_idempotency_unique" ON "loyalty_ledger_entry" USING btree ("branch_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "loyalty_lot_account_expiry_idx" ON "loyalty_lot" USING btree ("account_id","expires_at");--> statement-breakpoint
CREATE INDEX "loyalty_lot_expiry_idx" ON "loyalty_lot" USING btree ("expires_at") WHERE "loyalty_lot"."remaining_points" > 0;--> statement-breakpoint
CREATE UNIQUE INDEX "loyalty_lot_consumption_lot_entry_unique" ON "loyalty_lot_consumption" USING btree ("lot_id","entry_id");--> statement-breakpoint
CREATE INDEX "loyalty_lot_consumption_entry_idx" ON "loyalty_lot_consumption" USING btree ("entry_id");--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "customer_name_trgm_idx" ON "customer" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "customer_phone_trgm_idx" ON "customer" USING gin ("phone" gin_trgm_ops);