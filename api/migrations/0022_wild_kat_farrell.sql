ALTER TABLE "credit_ledger_entry" ADD COLUMN "shift_id" uuid;--> statement-breakpoint
ALTER TABLE "shift_report" ADD COLUMN "cash_repayment_minor" integer;--> statement-breakpoint
ALTER TABLE "credit_ledger_entry" ADD CONSTRAINT "credit_ledger_entry_shift_id_shift_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shift"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_ledger_entry_shift_idx" ON "credit_ledger_entry" USING btree ("shift_id","kind","method");