CREATE TYPE "public"."conflict_resolution_code" AS ENUM('CONFIRMED', 'CORRECTED_ELSEWHERE', 'ACCEPTED_RISK', 'TILL_INSTRUCTION', 'DUPLICATE');--> statement-breakpoint
CREATE TYPE "public"."supplier_transfer_status" AS ENUM('PENDING', 'AWAITING_OTP', 'SUCCESS', 'FAILED', 'REVERSED', 'BLOCKED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."evat_document_kind" AS ENUM('INVOICE', 'REFUND');--> statement-breakpoint
CREATE TYPE "public"."evat_submission_status" AS ENUM('QUEUED', 'WAITING_FOR_INVOICE', 'SUBMITTING', 'CERTIFIED', 'RETRY', 'ATTENTION');
