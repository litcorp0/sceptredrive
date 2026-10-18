CREATE TYPE "public"."stock_count_status" AS ENUM('OPEN', 'POSTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."stock_adjustment_reason" AS ENUM('DAMAGE', 'LOSS', 'FOUND', 'CORRECTION', 'EXPIRED', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."stock_movement_reference" AS ENUM('RECEIPT', 'ADJUSTMENT', 'TRANSFER', 'COUNT');--> statement-breakpoint
CREATE TYPE "public"."stock_movement_type" AS ENUM('RECEIPT', 'ADJUSTMENT', 'TRANSFER_OUT', 'TRANSFER_IN', 'COUNT_VARIANCE');--> statement-breakpoint
CREATE TYPE "public"."transfer_status" AS ENUM('DRAFT', 'DISPATCHED', 'RECEIVED', 'SHORT_CLOSED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "stock_count" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"category_id" uuid,
	"status" "stock_count_status" DEFAULT 'OPEN' NOT NULL,
	"note" text,
	"created_by" text,
	"posted_by" text,
	"posted_at" timestamp with time zone,
	"cancelled_by" text,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_count_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"count_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"snapshot_qty" integer NOT NULL,
	"counted_qty" integer
);
--> statement-breakpoint
CREATE TABLE "stock_level" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"quantity_on_hand" integer DEFAULT 0 NOT NULL,
	"avg_cost_minor" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_movement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"type" "stock_movement_type" NOT NULL,
	"quantity_delta" integer NOT NULL,
	"unit_cost_minor" integer NOT NULL,
	"reference_type" "stock_movement_reference" NOT NULL,
	"reference_id" uuid,
	"reference_number" text,
	"reason_code" "stock_adjustment_reason",
	"note" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_receipt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"supplier_name" text,
	"supplier_invoice_number" text,
	"note" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_receipt_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"unit_cost_minor" integer NOT NULL,
	"movement_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_threshold" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"threshold" integer NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transfer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"from_branch_id" uuid NOT NULL,
	"to_branch_id" uuid NOT NULL,
	"status" "transfer_status" DEFAULT 'DRAFT' NOT NULL,
	"note" text,
	"created_by" text,
	"dispatched_by" text,
	"dispatched_at" timestamp with time zone,
	"received_by" text,
	"received_at" timestamp with time zone,
	"closed_by" text,
	"closed_at" timestamp with time zone,
	"cancelled_by" text,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transfer_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transfer_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity_requested" integer NOT NULL,
	"quantity_dispatched" integer DEFAULT 0 NOT NULL,
	"quantity_received" integer DEFAULT 0 NOT NULL,
	"unit_cost_minor" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stock_count" ADD CONSTRAINT "stock_count_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count" ADD CONSTRAINT "stock_count_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_line" ADD CONSTRAINT "stock_count_line_count_id_stock_count_id_fk" FOREIGN KEY ("count_id") REFERENCES "public"."stock_count"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_line" ADD CONSTRAINT "stock_count_line_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_level" ADD CONSTRAINT "stock_level_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_level" ADD CONSTRAINT "stock_level_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_receipt" ADD CONSTRAINT "stock_receipt_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_receipt_line" ADD CONSTRAINT "stock_receipt_line_receipt_id_stock_receipt_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."stock_receipt"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_receipt_line" ADD CONSTRAINT "stock_receipt_line_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_receipt_line" ADD CONSTRAINT "stock_receipt_line_movement_id_stock_movement_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."stock_movement"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_threshold" ADD CONSTRAINT "stock_threshold_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_threshold" ADD CONSTRAINT "stock_threshold_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer" ADD CONSTRAINT "transfer_from_branch_id_branch_id_fk" FOREIGN KEY ("from_branch_id") REFERENCES "public"."branch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer" ADD CONSTRAINT "transfer_to_branch_id_branch_id_fk" FOREIGN KEY ("to_branch_id") REFERENCES "public"."branch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_line" ADD CONSTRAINT "transfer_line_transfer_id_transfer_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."transfer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_line" ADD CONSTRAINT "transfer_line_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_count_number_unique" ON "stock_count" USING btree ("number");--> statement-breakpoint
CREATE INDEX "stock_count_branch_idx" ON "stock_count" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "stock_count_status_idx" ON "stock_count" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_count_line_count_product_unique" ON "stock_count_line" USING btree ("count_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_level_product_branch_unique" ON "stock_level" USING btree ("product_id","branch_id");--> statement-breakpoint
CREATE INDEX "stock_level_branch_idx" ON "stock_level" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "stock_movement_product_branch_idx" ON "stock_movement" USING btree ("product_id","branch_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_movement_branch_idx" ON "stock_movement" USING btree ("branch_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_movement_reference_idx" ON "stock_movement" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "stock_movement_type_idx" ON "stock_movement" USING btree ("type","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_receipt_number_unique" ON "stock_receipt" USING btree ("number");--> statement-breakpoint
CREATE INDEX "stock_receipt_branch_idx" ON "stock_receipt" USING btree ("branch_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_receipt_line_receipt_product_unique" ON "stock_receipt_line" USING btree ("receipt_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_threshold_product_branch_unique" ON "stock_threshold" USING btree ("product_id","branch_id");--> statement-breakpoint
CREATE INDEX "stock_threshold_branch_idx" ON "stock_threshold" USING btree ("branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transfer_number_unique" ON "transfer" USING btree ("number");--> statement-breakpoint
CREATE INDEX "transfer_from_branch_idx" ON "transfer" USING btree ("from_branch_id");--> statement-breakpoint
CREATE INDEX "transfer_to_branch_idx" ON "transfer" USING btree ("to_branch_id");--> statement-breakpoint
CREATE INDEX "transfer_status_idx" ON "transfer" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "transfer_line_transfer_product_unique" ON "transfer_line" USING btree ("transfer_id","product_id");