// System ceilings — constants, never user-editable (POLICY_ENGINE.md §5, SECURITY §3 L3).
//
// Phase 3 owns the final list and `validatePolicyDraft`. Phase 2 needs a subset *now* to bound what a
// spend permission may grant, so the values below are the POLICY_ENGINE §5 numbers plus three
// spend-permission-specific bounds. They are deliberately conservative: Phase 3 may tighten them, and
// must not loosen them without recording a decision.
//
// I12: all money is bigint micro-USD (6 decimals). 1 USDC == 1_000_000 micro-USD.

const USDC = 1_000_000n;

export const SYSTEM_CEILINGS = {
  /** Hard cap per action. */
  MAX_PER_TX_MICRO_USD: 250_000n * USDC,
  /** Hard cap per rolling 24h. */
  MAX_DAILY_MICRO_USD: 1_000_000n * USDC,
  MAX_ACTIONS_PER_HOUR: 20,
  MAX_VAULTS: 5,
  MAX_RECIPIENTS: 50,
  PRICE_MAX_AGE_SEC: 60,
  RECEIPT_TTL_SEC: 120,
  MIN_CONFIDENCE_AUTONOMOUS: 0.6,

  // --- Spend Permission bounds (Phase 2; the on-chain authority cap, SECURITY §3 L2) -------------
  /** A permission may never grant more per period than the daily hard cap. */
  MAX_SPEND_PERMISSION_ALLOWANCE_MICRO_USD: 1_000_000n * USDC,
  /** Shortest and longest refill period we accept, in seconds (1 hour .. 30 days). */
  MIN_SPEND_PERMISSION_PERIOD_SEC: 3_600,
  MAX_SPEND_PERMISSION_PERIOD_SEC: 30 * 24 * 3_600,
  /** A permission may not run longer than a year from now. */
  MAX_SPEND_PERMISSION_HORIZON_SEC: 365 * 24 * 3_600,
  /** Clock-skew tolerance when checking that `start` is not in the past. */
  SPEND_PERMISSION_CLOCK_SKEW_SEC: 300,
} as const;

export type SystemCeilings = typeof SYSTEM_CEILINGS;
