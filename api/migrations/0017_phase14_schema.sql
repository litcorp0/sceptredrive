CREATE TABLE "evat_submission" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "evat_document_kind" NOT NULL,
	"branch_id" uuid NOT NULL,
	"terminal_id" uuid NOT NULL,
	"sale_id" uuid,
	"refund_id" uuid,
	"status" "evat_submission_status" DEFAULT 'QUEUED' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"due_at" timestamp with time zone NOT NULL,
	"provider" text NOT NULL,
	"provider_invoice_number" text,
	"sdc_id" text,
	"serial" text,
	"signature" text,
	"internal_data" text,
	"machine_code" text,
	"stamped_at" timestamp with time zone,
	"qr_payload" text,
	"last_error_code" text,
	"last_error_message" text,
	"submitted_at" timestamp with time zone,
	"certified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evat_submission_document_xor" CHECK ((("evat_submission"."kind" = 'INVOICE' and "evat_submission"."sale_id" is not null and "evat_submission"."refund_id" is null) or ("evat_submission"."kind" = 'REFUND' and "evat_submission"."refund_id" is not null and "evat_submission"."sale_id" is null)))
);
--> statement-breakpoint
CREATE TABLE "supplier_transfer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"payment_detail_id" uuid NOT NULL,
	"method" "supplier_payment_method" NOT NULL,
	"amount_minor" integer NOT NULL,
	"reference" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" "supplier_transfer_status" DEFAULT 'PENDING' NOT NULL,
	"provider" "payment_provider" NOT NULL,
	"recipient_code" text,
	"provider_transfer_code" text,
	"provider_transfer_id" text,
	"reason" text NOT NULL,
	"note" text,
	"failure_code" text,
	"failure_message" text,
	"payment_id" uuid,
	"unallocated_minor" integer DEFAULT 0 NOT NULL,
	"initiated_by" text,
	"finalized_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"last_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_transfer_amount_positive" CHECK ("supplier_transfer"."amount_minor" > 0),
	CONSTRAINT "supplier_transfer_reference_length" CHECK (char_length("supplier_transfer"."reference") between 16 and 50)
);
--> statement-breakpoint
CREATE TABLE "supplier_transfer_allocation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transfer_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount_minor" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_transfer_allocation_amount_positive" CHECK ("supplier_transfer_allocation"."amount_minor" > 0)
);
--> statement-breakpoint
ALTER TABLE "payment_event" ADD COLUMN "supplier_transfer_id" uuid;--> statement-breakpoint
ALTER TABLE "shift_report" ADD COLUMN "cash_refund_minor" integer;--> statement-breakpoint
ALTER TABLE "sync_conflict" ADD COLUMN "resolution_code" "conflict_resolution_code";--> statement-breakpoint
ALTER TABLE "evat_submission" ADD CONSTRAINT "evat_submission_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evat_submission" ADD CONSTRAINT "evat_submission_terminal_id_terminal_id_fk" FOREIGN KEY ("terminal_id") REFERENCES "public"."terminal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evat_submission" ADD CONSTRAINT "evat_submission_sale_id_sale_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sale"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evat_submission" ADD CONSTRAINT "evat_submission_refund_id_refund_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."refund"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_transfer" ADD CONSTRAINT "supplier_transfer_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_transfer" ADD CONSTRAINT "supplier_transfer_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_transfer" ADD CONSTRAINT "supplier_transfer_payment_detail_id_supplier_payment_detail_id_fk" FOREIGN KEY ("payment_detail_id") REFERENCES "public"."supplier_payment_detail"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_transfer" ADD CONSTRAINT "supplier_transfer_payment_id_supplier_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."supplier_payment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_transfer_allocation" ADD CONSTRAINT "supplier_transfer_allocation_transfer_id_supplier_transfer_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."supplier_transfer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_transfer_allocation" ADD CONSTRAINT "supplier_transfer_allocation_invoice_id_supplier_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."supplier_invoice"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "evat_submission_sale_unique" ON "evat_submission" USING btree ("sale_id") WHERE "evat_submission"."sale_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "evat_submission_refund_unique" ON "evat_submission" USING btree ("refund_id") WHERE "evat_submission"."refund_id" is not null;--> statement-breakpoint
CREATE INDEX "evat_submission_queue_idx" ON "evat_submission" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "evat_submission_branch_created_idx" ON "evat_submission" USING btree ("branch_id","created_at" desc);--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_transfer_reference_unique" ON "supplier_transfer" USING btree ("reference");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_transfer_idempotency_unique" ON "supplier_transfer" USING btree ("branch_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_transfer_payment_unique" ON "supplier_transfer" USING btree ("payment_id") WHERE "supplier_transfer"."payment_id" is not null;--> statement-breakpoint
CREATE INDEX "supplier_transfer_branch_created_idx" ON "supplier_transfer" USING btree ("branch_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "supplier_transfer_status_created_idx" ON "supplier_transfer" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "supplier_transfer_supplier_created_idx" ON "supplier_transfer" USING btree ("supplier_id","created_at" desc);--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_transfer_allocation_transfer_invoice_unique" ON "supplier_transfer_allocation" USING btree ("transfer_id","invoice_id");--> statement-breakpoint
ALTER TABLE "payment_event" ADD CONSTRAINT "payment_event_supplier_transfer_id_supplier_transfer_id_fk" FOREIGN KEY ("supplier_transfer_id") REFERENCES "public"."supplier_transfer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_event_transfer_idx" ON "payment_event" USING btree ("supplier_transfer_id");--> statement-breakpoint
CREATE INDEX "sync_conflict_status_created_idx" ON "sync_conflict" USING btree ("status","created_at" desc);
