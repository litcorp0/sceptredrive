import type { FlagKey } from '@sceptre/shared'
import { z } from 'zod'
import { env } from '../../config/env.ts'
import { validateJson, validateQuery } from '../../http/validation.ts'

/**
 * The three feature flags (P14-D41). A flag is a typed boolean setting, not a
 * second store: it is read, written and audited by the settings path that
 * already exists, and it is on by default because this phase ships the features.
 */
const FLAG_SETTING_DEFINITIONS = {
  'flag.supplierTransfers': {
    schema: z.boolean(),
    defaultValue: true,
    branchScoped: false,
    writableBy: 'admin',
  },
  'flag.evatSubmission': {
    schema: z.boolean(),
    defaultValue: true,
    branchScoped: false,
    writableBy: 'admin',
  },
  'flag.posConflictResolution': {
    schema: z.boolean(),
    defaultValue: true,
    branchScoped: false,
    writableBy: 'admin',
  },
} as const satisfies Record<
  FlagKey,
  { schema: z.ZodBoolean; defaultValue: boolean; branchScoped: boolean; writableBy: 'admin' }
>

type FlagSettingKey = keyof typeof FLAG_SETTING_DEFINITIONS

/**
 * `satisfies Record<FlagKey, …>` above proves every registry flag has a setting;
 * this proves the settings add no flag the registry does not name. Remove either
 * direction and `check-types` fails, which is the point: the console renders the
 * registry and the API enforces the settings, so a drift between them is a screen
 * that lies about what it can turn off.
 */
type FlagSettingsMatchRegistry = [FlagSettingKey] extends [FlagKey]
  ? [FlagKey] extends [FlagSettingKey]
    ? true
    : false
  : false

export const FLAG_SETTING_KEYS_ARE_EXACT: FlagSettingsMatchRegistry = true

export const SETTING_DEFINITIONS = {
  'staff.idPrefix': {
    schema: z
      .string()
      .trim()
      .min(1)
      .max(8)
      .regex(/^[A-Za-z0-9]+$/),
    defaultValue: env.STAFF_ID_PREFIX,
    branchScoped: false,
  },
  'staff.idSequence': {
    schema: z.number().int().positive(),
    defaultValue: env.STAFF_ID_START,
    branchScoped: false,
  },
  'receipt.header': {
    schema: z.string().trim().min(1).max(200),
    defaultValue: 'Thank you for shopping at Sceptre Drive',
    branchScoped: true,
  },
  'loyalty.earnPointsPerCedi': {
    schema: z.number().int().min(1),
    defaultValue: 1,
    branchScoped: false,
  },
  'loyalty.pointsPerCedi': {
    schema: z.number().positive(),
    defaultValue: 100,
    branchScoped: false,
  },
  'loyalty.expiryMonths': {
    schema: z.number().int().positive(),
    defaultValue: 12,
    branchScoped: false,
  },
  'loyalty.minimumRedeemPoints': {
    schema: z.number().int().min(1),
    defaultValue: 100,
    branchScoped: false,
  },
  'credit.repaymentPrefix': {
    schema: z
      .string()
      .trim()
      .min(1)
      .max(8)
      .regex(/^[A-Za-z0-9]+$/),
    defaultValue: 'REP',
    branchScoped: false,
  },
  'credit.repaymentSequence': {
    schema: z.number().int().positive(),
    defaultValue: 1,
    branchScoped: false,
  },
  'catalog.skuPrefix': {
    schema: z
      .string()
      .trim()
      .min(1)
      .max(8)
      .regex(/^[A-Za-z0-9]+$/),
    defaultValue: 'GIK',
    branchScoped: false,
  },
  'catalog.skuSequence': {
    schema: z.number().int().positive(),
    defaultValue: 1,
    branchScoped: false,
  },
  'pricing.taxMode': {
    schema: z.enum(['INCLUSIVE', 'EXCLUSIVE']),
    defaultValue: 'INCLUSIVE',
    branchScoped: false,
  },
  'inventory.receiptPrefix': {
    schema: z
      .string()
      .trim()
      .min(1)
      .max(8)
      .regex(/^[A-Za-z0-9]+$/),
    defaultValue: 'GRN',
    branchScoped: false,
  },
  'inventory.receiptSequence': {
    schema: z.number().int().positive(),
    defaultValue: 1,
    branchScoped: false,
  },
  'inventory.transferPrefix': {
    schema: z
      .string()
      .trim()
      .min(1)
      .max(8)
      .regex(/^[A-Za-z0-9]+$/),
    defaultValue: 'TRF',
    branchScoped: false,
  },
  'inventory.transferSequence': {
    schema: z.number().int().positive(),
    defaultValue: 1,
    branchScoped: false,
  },
  'inventory.countPrefix': {
    schema: z
      .string()
      .trim()
      .min(1)
      .max(8)
      .regex(/^[A-Za-z0-9]+$/),
    defaultValue: 'CNT',
    branchScoped: false,
  },
  'inventory.countSequence': {
    schema: z.number().int().positive(),
    defaultValue: 1,
    branchScoped: false,
  },
  'supplier.codePrefix': {
    schema: z
      .string()
      .trim()
      .min(1)
      .max(8)
      .regex(/^[A-Za-z0-9]+$/),
    defaultValue: 'SUP',
    branchScoped: false,
  },
  'supplier.codeSequence': {
    schema: z.number().int().positive(),
    defaultValue: 1,
    branchScoped: false,
  },
  'payable.invoicePrefix': {
    schema: z
      .string()
      .trim()
      .min(1)
      .max(8)
      .regex(/^[A-Za-z0-9]+$/),
    defaultValue: 'SINV',
    branchScoped: false,
  },
  'payable.invoiceSequence': {
    schema: z.number().int().positive(),
    defaultValue: 1,
    branchScoped: false,
  },
  'payable.paymentPrefix': {
    schema: z
      .string()
      .trim()
      .min(1)
      .max(8)
      .regex(/^[A-Za-z0-9]+$/),
    defaultValue: 'PAY',
    branchScoped: false,
  },
  'payable.paymentSequence': {
    schema: z.number().int().positive(),
    defaultValue: 1,
    branchScoped: false,
  },
  'pos.maxCashierDiscountPercent': {
    schema: z.number().int().min(0).max(100),
    defaultValue: 0,
    branchScoped: false,
  },
  'pos.maxManagerDiscountPercent': {
    schema: z.number().int().min(0).max(100),
    defaultValue: 100,
    branchScoped: false,
  },
  'pos.pinMaxAttempts': {
    schema: z.number().int().min(3).max(10),
    defaultValue: 5,
    branchScoped: false,
  },
  'pos.pinLockMinutes': {
    schema: z.number().int().min(1).max(60),
    defaultValue: 5,
    branchScoped: false,
  },
  'pos.clockSkewToleranceMinutes': {
    schema: z.number().int().min(1).max(120),
    defaultValue: 10,
    branchScoped: false,
  },
  'pos.syncBatchSize': {
    schema: z.number().int().min(1).max(50),
    defaultValue: 25,
    branchScoped: false,
  },
  'pos.receiptFooter': {
    schema: z.string().trim().min(1).max(200),
    defaultValue: 'Thank you for your business',
    branchScoped: false,
  },
  'pos.salesRequireOpenShift': {
    schema: z.boolean(),
    defaultValue: true,
    branchScoped: false,
  },
  // --- Phase 11: procurement -------------------------------------------------
  /**
   * The goods value at or above which an admin must decide a purchase order.
   * Branch-overridable but admin-writable: a branch that can raise its own limit
   * has no limit (P11-D2).
   */
  'procurement.approvalThresholdMinor': {
    schema: z.number().int().min(0).max(1_000_000_000),
    defaultValue: 1_000_000,
    branchScoped: true,
    writableBy: 'admin',
  },
  /** Extra days of cover added to the supplier lead time (P11-D12). */
  'procurement.safetyDays': {
    schema: z.number().int().min(0).max(365),
    defaultValue: 7,
    branchScoped: true,
    writableBy: 'manager',
  },
  /** Lead time assumed when the supplier-product link has none. */
  'procurement.defaultLeadDays': {
    schema: z.number().int().min(1).max(365),
    defaultValue: 14,
    branchScoped: false,
  },
  'procurement.orderPrefix': {
    schema: z
      .string()
      .trim()
      .min(1)
      .max(8)
      .regex(/^[A-Za-z0-9]+$/),
    defaultValue: 'PO',
    branchScoped: false,
  },
  'procurement.returnPrefix': {
    schema: z
      .string()
      .trim()
      .min(1)
      .max(8)
      .regex(/^[A-Za-z0-9]+$/),
    defaultValue: 'PR',
    branchScoped: false,
  },
  'procurement.creditNotePrefix': {
    schema: z
      .string()
      .trim()
      .min(1)
      .max(8)
      .regex(/^[A-Za-z0-9]+$/),
    defaultValue: 'SCN',
    branchScoped: false,
  },
  // --- Phase 12: branch operations and approvals -----------------------------
  /**
   * How far a manager may move a price without an approval, in whole percent
   * (P12-D18). Global and admin-only: a branch that sets its own band has none.
   */
  'pricing.managerBandPercent': {
    schema: z.number().int().min(0).max(100),
    defaultValue: 10,
    branchScoped: false,
    writableBy: 'admin',
  },
  /**
   * A close with |variance| strictly greater than this raises a review (P12-D24,
   * P12-D25). Branch-overridable but admin-writable: a branch that sets its own
   * tolerance has none.
   */
  'pos.shiftVarianceToleranceMinor': {
    schema: z.number().int().min(0).max(1_000_000),
    defaultValue: 2_000,
    branchScoped: true,
    writableBy: 'admin',
  },
  /** A posted count whose |variance value| exceeds this raises a trigger count (P12-D32). */
  'inventory.countVarianceToleranceMinor': {
    schema: z.number().int().min(0).max(1_000_000),
    defaultValue: 1_000,
    branchScoped: true,
    writableBy: 'admin',
  },
  /** The branch-month serial prefix for a write-off: `WO-ACC-202610-0001` (P12-D14). */
  'inventory.writeOffPrefix': {
    schema: z
      .string()
      .trim()
      .min(1)
      .max(8)
      .regex(/^[A-Z]+$/),
    defaultValue: 'WO',
    branchScoped: false,
    writableBy: 'admin',
  },
  /**
   * Cumulative score share at which a product is class A, in basis points
   * (P12-D29). Must stay below `inventory.abcBThresholdBp`; `settings.service`
   * enforces the pair because one schema cannot see the other value.
   */
  'inventory.abcAThresholdBp': {
    schema: z.number().int().min(1).max(9_999),
    defaultValue: 8_000,
    branchScoped: false,
    writableBy: 'admin',
  },
  'inventory.abcBThresholdBp': {
    schema: z.number().int().min(2).max(10_000),
    defaultValue: 9_500,
    branchScoped: false,
    writableBy: 'admin',
  },
  // --- Phase 13: POS payments, refunds and returns ---------------------------
  /**
   * The gross refund on one document at or above which an admin must decide it
   * (P13-D21). It does not accumulate across refunds of the same sale, and `>=`
   * triggers, so a refund of exactly GH₵200 raises one. Branch-overridable but
   * admin-writable for the same reason the shift variance tolerance is: a
   * branch that can set its own refund cap has none.
   *
   * There is deliberately no refund prefix or sequence here. The till allocates
   * `RF-<terminalCode>-<day>-NNNN` from its local `document_sequence` so a
   * refund can be numbered offline; the server stores the number and enforces
   * uniqueness (P13-D37).
   */
  'pos.refundApprovalThresholdMinor': {
    schema: z.number().int().min(0).max(1_000_000),
    defaultValue: 20_000,
    branchScoped: true,
    writableBy: 'admin',
  },
  // --- Phase 14: seller identity and the typed feature flags ------------------
  /**
   * The company's TIN and VAT number (P14-D38). There is no TIN column on
   * `branch`: the company holds one of each, and a per-branch copy is a number
   * that goes stale in one place.
   *
   * The empty string is the honest default for a number we do not have yet: the
   * receipt copy prints nothing rather than printing `undefined`, and the E-VAT
   * payload is refused in the service rather than submitted blank.
   */
  'tax.sellerTin': {
    schema: z.string().trim().max(30),
    defaultValue: '',
    branchScoped: false,
    writableBy: 'admin',
  },
  'tax.sellerVatNumber': {
    schema: z.string().trim().max(30),
    defaultValue: '',
    branchScoped: false,
    writableBy: 'admin',
  },
  ...FLAG_SETTING_DEFINITIONS,
} as const

export type SettingKey = keyof typeof SETTING_DEFINITIONS

export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTING_DEFINITIONS)[K]['schema']>

export function isSettingKey(value: string): value is SettingKey {
  return Object.hasOwn(SETTING_DEFINITIONS, value)
}

export const settingsListQuerySchema = z.object({
  branchId: z.uuid().optional(),
})

export const settingsUpdateSchema = z
  .object({
    key: z.string().trim().min(1).max(120),
    value: z.unknown(),
    branchId: z.uuid().nullish(),
  })
  .strict()

export const validateSettingsListQuery = validateQuery(settingsListQuerySchema)
export const validateSettingsUpdate = validateJson(settingsUpdateSchema)
