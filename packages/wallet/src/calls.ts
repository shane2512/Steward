// A `Call` is one entry of a batched user operation. Phase 2 only *builds* these; the single place
// allowed to send them is `executor.ts` (Phase 5). Simulation (RiskGate) and execution must use the
// same `Call[]`, keyed by `callsHash`.
import { hashCanonical, type Address } from '@steward/shared';
import type { Hex } from 'viem';

export type Call = {
  to: Address;
  data: Hex;
  /** Always 0n for Steward: the agent moves ERC-20 value, never native ETH. */
  value: bigint;
};

/** Stable hash over the exact calls, used to prove simulation and execution saw the same bytes. */
export function callsHash(calls: readonly Call[]): Hex {
  return hashCanonical(calls.map((c) => ({ to: c.to, data: c.data, value: c.value })));
}
