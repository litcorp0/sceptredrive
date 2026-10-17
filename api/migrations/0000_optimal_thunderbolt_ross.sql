CREATE TYPE "public"."branch_type" AS ENUM('RETAIL', 'WAREHOUSE');--> statement-breakpoint
CREATE TYPE "public"."device_status" AS ENUM('ACTIVE', 'REVOKED');--> statement-breakpoint
CREATE TABLE "branch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" "branch_type" DEFAULT 'RETAIL' NOT NULL,
	"city" text NOT NULL,
	"area" text,
	"address" text,
	"phone" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"terminal_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"token_hash" text NOT NULL,
	"status" "device_status" DEFAULT 'ACTIVE' NOT NULL,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	"last_seen_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "terminal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "terminal_enrollment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"terminal_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" text,
	"actor_staff_id" text,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"branch_id" uuid,
	"terminal_id" uuid,
	"ip" text,
	"user_agent" text,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "setting" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"branch_id" uuid,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "device" ADD CONSTRAINT "device_terminal_id_terminal_id_fk" FOREIGN KEY ("terminal_id") REFERENCES "public"."terminal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminal" ADD CONSTRAINT "terminal_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminal_enrollment" ADD CONSTRAINT "terminal_enrollment_terminal_id_terminal_id_fk" FOREIGN KEY ("terminal_id") REFERENCES "public"."terminal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "branch_code_unique" ON "branch" USING btree ("code");--> statement-breakpoint
CREATE INDEX "branch_type_idx" ON "branch" USING btree ("type");--> statement-breakpoint
CREATE INDEX "branch_active_idx" ON "branch" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "device_token_hash_unique" ON "device" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "device_terminal_idx" ON "device" USING btree ("terminal_id");--> statement-breakpoint
CREATE INDEX "device_status_idx" ON "device" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "terminal_code_unique" ON "terminal" USING btree ("code");--> statement-breakpoint
CREATE INDEX "terminal_branch_idx" ON "terminal" USING btree ("branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "terminal_enrollment_code_hash_unique" ON "terminal_enrollment" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "terminal_enrollment_terminal_idx" ON "terminal_enrollment" USING btree ("terminal_id");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "audit_branch_created_idx" ON "audit_log" USING btree ("branch_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_actor_idx" ON "audit_log" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "setting_global_key_unique" ON "setting" USING btree ("key") WHERE "setting"."branch_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "setting_branch_key_unique" ON "setting" USING btree ("branch_id","key") WHERE "setting"."branch_id" is not null;--> statement-breakpoint
CREATE INDEX "setting_branch_idx" ON "setting" USING btree ("branch_id");