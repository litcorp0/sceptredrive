ALTER TYPE "public"."stock_movement_reference" ADD VALUE IF NOT EXISTS 'REFUND';--> statement-breakpoint
ALTER TYPE "public"."stock_movement_type" ADD VALUE IF NOT EXISTS 'RETURN';--> statement-breakpoint
ALTER TYPE "public"."pos_transaction_type" ADD VALUE IF NOT EXISTS 'REFUND';--> statement-breakpoint
ALTER TYPE "public"."pos_transaction_type" ADD VALUE IF NOT EXISTS 'CREDIT_REPAYMENT';--> statement-breakpoint
ALTER TYPE "public"."pos_transaction_type" ADD VALUE IF NOT EXISTS 'CART_VOID';--> statement-breakpoint
ALTER TYPE "public"."sale_tender_method" ADD VALUE IF NOT EXISTS 'MOMO';--> statement-breakpoint
ALTER TYPE "public"."sale_tender_method" ADD VALUE IF NOT EXISTS 'CARD';--> statement-breakpoint
ALTER TYPE "public"."sale_tender_method" ADD VALUE IF NOT EXISTS 'BANK_TRANSFER';--> statement-breakpoint
ALTER TYPE "public"."sync_conflict_type" ADD VALUE IF NOT EXISTS 'PAYMENT_LATE_SETTLEMENT';--> statement-breakpoint
ALTER TYPE "public"."sync_conflict_type" ADD VALUE IF NOT EXISTS 'PAYMENT_AMOUNT_MISMATCH';
