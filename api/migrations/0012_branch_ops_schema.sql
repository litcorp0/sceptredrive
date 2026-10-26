CREATE TYPE "public"."abc_class" AS ENUM('A', 'B', 'C');--> statement-breakpoint
CREATE TYPE "public"."count_frequency" AS ENUM('WEEKLY', 'MONTHLY', 'QUARTERLY', 'BIANNUAL');--> statement-breakpoint
CREATE TYPE "public"."count_scope" AS ENUM('CATEGORY', 'BRAND', 'ABC_CLASS', 'ROTATION');--> statement-breakpoint
CREATE TYPE "public"."count_trigger_reason" AS ENUM('VARIANCE', 'OVERSELL');--> statement-breakpoint
CREATE TYPE "public"."count_type" AS ENUM('MANUAL', 'SCHEDULED', 'TRIGGER');--> statement-breakpoint
CREATE TYPE "public"."shift_review_status" AS ENUM('NONE', 'REQUIRED', 'REVIEWED');--> statement-breakpoint
CREATE TYPE "public"."stock_write_off_reason" AS ENUM('DAMAGE', 'EXPIRY', 'OBSOLESCENCE', 'THEFT', 'SUPPLIER_FAULT', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."stock_write_off_status" AS ENUM('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "count_schedule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"scope" "count_scope" NOT NULL,
	"scope_key" text NOT NULL,
	"frequency" "count_frequency" NOT NULL,
	"next_due_at" date NOT NULL,
	"assigned_to" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_abc_class" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"class" "abc_class" NOT NULL,
	"value_minor" integer DEFAULT 0 NOT NULL,
	"sold_minor" integer DEFAULT 0 NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_manual" boolean DEFAULT false NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_write_off" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"status" "stock_write_off_status" DEFAULT 'PENDING_APPROVAL' NOT NULL,
	"note" text,
	"value_minor" integer DEFAULT 0 NOT NULL,
	"approval_id" uuid,
	"requested_by" text NOT NULL,
	"posted_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_by" text,
	"cancelled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "stock_write_off_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"write_off_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"unit_cost_minor" integer NOT NULL,
	"reason" "stock_write_off_reason" NOT NULL,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "approval" ADD COLUMN "decider_role" text DEFAULT 'ADMIN' NOT NULL;--> statement-breakpoint
ALTER TABLE "approval" ADD COLUMN "decider_branch_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_count" ADD COLUMN "count_type" "count_type" DEFAULT 'MANUAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_count" ADD COLUMN "scope" "count_scope";--> statement-breakpoint
ALTER TABLE "stock_count" ADD COLUMN "scope_key" text;--> statement-breakpoint
ALTER TABLE "stock_count" ADD COLUMN "due_at" date;--> statement-breakpoint
ALTER TABLE "stock_count" ADD COLUMN "assigned_to" text;--> statement-breakpoint
ALTER TABLE "stock_count" ADD COLUMN "schedule_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_count" ADD COLUMN "trigger_reason" "count_trigger_reason";--> statement-breakpoint
ALTER TABLE "stock_count" ADD COLUMN "trigger_product_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_count" ADD COLUMN "trigger_source_id" uuid;--> statement-breakpoint
ALTER TABLE "shift" ADD COLUMN "review_status" "shift_review_status" DEFAULT 'NONE' NOT NULL;--> statement-breakpoint
ALTER TABLE "shift" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "shift" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shift" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "count_schedule" ADD CONSTRAINT "count_schedule_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_abc_class" ADD CONSTRAINT "stock_abc_class_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_abc_class" ADD CONSTRAINT "stock_abc_class_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_write_off" ADD CONSTRAINT "stock_write_off_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_write_off" ADD CONSTRAINT "stock_write_off_approval_id_approval_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approval"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_write_off_line" ADD CONSTRAINT "stock_write_off_line_write_off_id_stock_write_off_id_fk" FOREIGN KEY ("write_off_id") REFERENCES "public"."stock_write_off"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_write_off_line" ADD CONSTRAINT "stock_write_off_line_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "count_schedule_branch_scope_unique" ON "count_schedule" USING btree ("branch_id","scope_key");--> statement-breakpoint
CREATE INDEX "count_schedule_active_due_idx" ON "count_schedule" USING btree ("is_active","next_due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_abc_class_product_branch_unique" ON "stock_abc_class" USING btree ("product_id","branch_id");--> statement-breakpoint
CREATE INDEX "stock_abc_class_branch_class_idx" ON "stock_abc_class" USING btree ("branch_id","class");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_write_off_number_unique" ON "stock_write_off" USING btree ("number");--> statement-breakpoint
CREATE INDEX "stock_write_off_branch_status_created_idx" ON "stock_write_off" USING btree ("branch_id","status","created_at");--> statement-breakpoint
CREATE INDEX "stock_write_off_approval_idx" ON "stock_write_off" USING btree ("approval_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_write_off_line_write_off_product_unique" ON "stock_write_off_line" USING btree ("write_off_id","product_id");--> statement-breakpoint
CREATE INDEX "stock_write_off_line_product_idx" ON "stock_write_off_line" USING btree ("product_id");--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_decider_branch_id_branch_id_fk" FOREIGN KEY ("decider_branch_id") REFERENCES "public"."branch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count" ADD CONSTRAINT "stock_count_schedule_id_count_schedule_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."count_schedule"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count" ADD CONSTRAINT "stock_count_trigger_product_id_product_id_fk" FOREIGN KEY ("trigger_product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_decider_idx" ON "approval" USING btree ("decider_role","decider_branch_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_count_open_trigger_unique" ON "stock_count" USING btree ("branch_id","trigger_product_id") WHERE "stock_count"."status" = 'OPEN' and "stock_count"."trigger_product_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_count_open_schedule_unique" ON "stock_count" USING btree ("schedule_id") WHERE "stock_count"."status" = 'OPEN' and "stock_count"."schedule_id" is not null;--> statement-breakpoint
CREATE INDEX "shift_review_idx" ON "shift" USING btree ("branch_id","review_status","closed_at");--> statement-breakpoint
CREATE INDEX "sync_conflict_type_created_idx" ON "sync_conflict" USING btree ("type","created_at");