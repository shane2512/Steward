// R09 — concentration: after the deposit, this vault may hold at most `maxAllocationBps` of the
// managed funds (liquid USDC + every vault position). ESCALATE on breach — an owner may knowingly
// go heavier, but the agent may not decide that alone.
//
// bps math is done as `position * 10_000 > bps * managed` in bigint: no division, so no rounding
// window an attacker could sit in (I12).
import { baseUnitsToMicroUsd, priceOf, usdcToken } from '../units';
import { deny, escalate, pass, type Rule } from './kit';

export const R09: Rule = (input) => {
  if (input.proposal.kind !== 'vault_deposit') return pass('R09', 'not a vault deposit');
  const { vaultId, amount } = input.proposal.params;

  const token = usdcToken(input.policy);
  if (!token) return deny('R09', 'policy has no USDC token');
  const price = priceOf(input, token.address);
  if (!price.ok) return deny('R09', `cannot value positions: ${price.error}`);

  const positions = Object.values(input.state.vaultPositions).reduce((a, b) => a + b, 0n);
  const managed = baseUnitsToMicroUsd(
    input.state.agentUsdc + input.state.treasuryUsdc + positions,
    token.decimals,
    price.value.quote,
  );
  const post = baseUnitsToMicroUsd(
    (input.state.vaultPositions[vaultId] ?? 0n) + amount,
    token.decimals,
    price.value.quote,
  );
  if (!managed.ok || !post.ok) return deny('R09', 'cannot value positions at the oracle price');
  if (managed.value <= 0n) return escalate('R09', 'managed funds are 0; allocation is unverifiable');

  const vault = input.policy.vaults.find((v) => v.id === vaultId);
  // An unknown vault is R04's DENY; use 0 bps here so this rule cannot silently pass it.
  const bps = BigInt(vault?.maxAllocationBps ?? 0);
  return post.value * 10_000n > bps * managed.value
    ? escalate(
        'R09',
        `vault ${vaultId} would hold ${post.value} of ${managed.value} micro-USD, over ${bps} bps`,
      )
    : pass('R09', `vault ${vaultId} would hold ${post.value} of ${managed.value} micro-USD`);
};
