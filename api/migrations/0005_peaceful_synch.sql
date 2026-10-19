CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TYPE "public"."supplier_momo_network" AS ENUM('MTN', 'VOD', 'ATL');--> statement-breakpoint
CREATE TYPE "public"."supplier_payment_detail_method" AS ENUM('BANK', 'MOMO');--> statement-breakpoint
CREATE TYPE "public"."supplier_status" AS ENUM('ACTIVE', 'ARCHIVED');--> statement-breakpoint
CREATE TABLE "supplier" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"contact_name" text,
	"phone" text,
	"email" text,
	"address" text,
	"tin" text,
	"vat_number" text,
	"payment_term_days" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"status" "supplier_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_payment_detail" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"method" "supplier_payment_detail_method" NOT NULL,
	"label" text,
	"account_name" text,
	"account_number" text,
	"bank_name" text,
	"bank_code" text,
	"momo_network" "supplier_momo_network",
	"phone" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"paystack_recipient_code" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_product" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"supplier_sku" text,
	"lead_time_days" integer,
	"last_cost_minor" integer DEFAULT 0 NOT NULL,
	"last_cost_at" timestamp with time zone,
	"is_preferred" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "supplier_payment_detail" ADD CONSTRAINT "supplier_payment_detail_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_product" ADD CONSTRAINT "supplier_product_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_product" ADD CONSTRAINT "supplier_product_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_code_unique" ON "supplier" USING btree ("code");--> statement-breakpoint
CREATE INDEX "supplier_name_trgm_idx" ON "supplier" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "supplier_status_idx" ON "supplier" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_payment_detail_account_unique" ON "supplier_payment_detail" USING btree ("supplier_id","method","account_number");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_payment_detail_default_unique" ON "supplier_payment_detail" USING btree ("supplier_id") WHERE "supplier_payment_detail"."is_default" and "supplier_payment_detail"."is_active";--> statement-breakpoint
CREATE INDEX "supplier_payment_detail_supplier_idx" ON "supplier_payment_detail" USING btree ("supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_product_supplier_product_unique" ON "supplier_product" USING btree ("supplier_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_product_preferred_unique" ON "supplier_product" USING btree ("product_id") WHERE "supplier_product"."is_preferred";--> statement-breakpoint
CREATE INDEX "supplier_product_product_idx" ON "supplier_product" USING btree ("product_id");