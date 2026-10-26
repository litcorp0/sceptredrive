ALTER TYPE "public"."transfer_status" ADD VALUE IF NOT EXISTS 'REQUESTED';--> statement-breakpoint
ALTER TYPE "public"."transfer_status" ADD VALUE IF NOT EXISTS 'APPROVED';--> statement-breakpoint
ALTER TYPE "public"."transfer_status" ADD VALUE IF NOT EXISTS 'REJECTED';--> statement-breakpoint
ALTER TYPE "public"."stock_movement_type" ADD VALUE IF NOT EXISTS 'WRITE_OFF';--> statement-breakpoint
ALTER TYPE "public"."stock_movement_reference" ADD VALUE IF NOT EXISTS 'WRITE_OFF';--> statement-breakpoint
ALTER TYPE "public"."stock_adjustment_reason" ADD VALUE IF NOT EXISTS 'THEFT';--> statement-breakpoint
ALTER TYPE "public"."stock_adjustment_reason" ADD VALUE IF NOT EXISTS 'OBSOLESCENCE';--> statement-breakpoint
ALTER TYPE "public"."stock_adjustment_reason" ADD VALUE IF NOT EXISTS 'SUPPLIER_FAULT';
