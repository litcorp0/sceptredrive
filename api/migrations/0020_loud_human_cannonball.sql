CREATE TYPE "public"."stock_opening_status" AS ENUM('DRAFT', 'POSTED');--> statement-breakpoint
ALTER TYPE "public"."stock_movement_reference" ADD VALUE 'OPENING';--> statement-breakpoint
ALTER TYPE "public"."stock_movement_type" ADD VALUE 'OPENING';--> statement-breakpoint
CREATE TABLE "stock_opening" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"status" "stock_opening_status" DEFAULT 'DRAFT' NOT NULL,
	"counted_at" timestamp with time zone NOT NULL,
	"note" text,
	"idempotency_key" text,
	"line_count" integer DEFAULT 0 NOT NULL,
	"new_product_count" integer DEFAULT 0 NOT NULL,
	"total_units" integer DEFAULT 0 NOT NULL,
	"counted_value_minor" integer DEFAULT 0 NOT NULL,
	"posted_value_minor" integer DEFAULT 0 NOT NULL,
	"uncosted_line_count" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"posted_by" text,
	"posted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "stock_opening_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opening_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"product_id" uuid,
	"is_new" boolean DEFAULT false NOT NULL,
	"sku" text,
	"name" text NOT NULL,
	"category_id" uuid,
	"uom_id" uuid,
	"brand_id" uuid,
	"barcode" text,
	"base_price_minor" integer,
	"tax_category" "tax_category",
	"quantity" integer NOT NULL,
	"unit_cost_minor" integer NOT NULL,
	"on_hand_at_draft" integer DEFAULT 0 NOT NULL,
	"delta_at_draft" integer DEFAULT 0 NOT NULL,
	"warning" text,
	"movement_id" uuid
);
--> statement-breakpoint
ALTER TABLE "stock_opening" ADD CONSTRAINT "stock_opening_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_opening_line" ADD CONSTRAINT "stock_opening_line_opening_id_stock_opening_id_fk" FOREIGN KEY ("opening_id") REFERENCES "public"."stock_opening"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_opening_line" ADD CONSTRAINT "stock_opening_line_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_opening_line" ADD CONSTRAINT "stock_opening_line_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_opening_line" ADD CONSTRAINT "stock_opening_line_uom_id_uom_id_fk" FOREIGN KEY ("uom_id") REFERENCES "public"."uom"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_opening_line" ADD CONSTRAINT "stock_opening_line_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_opening_line" ADD CONSTRAINT "stock_opening_line_movement_id_stock_movement_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."stock_movement"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_opening_number_unique" ON "stock_opening" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_opening_branch_idempotency_unique" ON "stock_opening" USING btree ("branch_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "stock_opening_branch_status_created_idx" ON "stock_opening" USING btree ("branch_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_opening_line_opening_line_no_unique" ON "stock_opening_line" USING btree ("opening_id","line_no");--> statement-breakpoint
CREATE INDEX "stock_opening_line_opening_idx" ON "stock_opening_line" USING btree ("opening_id");--> statement-breakpoint
CREATE INDEX "stock_opening_line_product_idx" ON "stock_opening_line" USING btree ("product_id");