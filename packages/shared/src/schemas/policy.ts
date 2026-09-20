// Policy schema per POLICY_ENGINE.md §2. Stub: shape only; ceilings/validation live in packages/policy (Phase 3).
import { z } from 'zod';
import { zAddress, zAmount, zChainId, zHex } from './primitives';
import { zProposalKind } from './proposal';

export const zPolicy = z.object({
  version: z.number().int().positive(),
  walletId: z.string(),
  chainId: zChainId,
  treasuryAddress: zAddress,
  tokens: z.array(
    z.object({ symbol: z.literal('USDC'), address: zAddress, decimals: z.literal(6) }),
  ),
  vaults: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      address: zAddress,
      asset: zAddress,
      kind: z.literal('erc4626'),
      maxAllocationBps: z.number().int().min(0).max(10_000),
    }),
  ),
  recipients: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      address: zAddress,
      maxPerTxMicroUsd: zAmount,
      schedule: z
        .object({ dayOfMonth: z.number().int().min(1).max(28), amountMicroUsd: zAmount })
        .optional(),
    }),
  ),
  limits: z.object({
    perTxMicroUsd: zAmount,
    dailyMicroUsd: zAmount,
    maxActionsPerHour: z.number().int().positive(),
  }),
  runwayBufferMicroUsd: zAmount,
  approvalThresholdMicroUsd: zAmount,
  approvalThresholdByKind: z.partialRecord(zProposalKind, zAmount).optional(),
  depegThresholdBps: z.number().int().min(0).max(10_000),
  vaultDrawdownBps: z.number().int().min(0).max(10_000),
  autonomousKinds: z.array(zProposalKind),
  x402: z.object({ dailyBudgetMicroUsd: zAmount, allowedHosts: z.array(z.string()) }).optional(),
  createdAt: z.string(),
  signedBy: zAddress,
  signature: zHex,
});
export type Policy = z.infer<typeof zPolicy>;
