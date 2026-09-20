// R12 — price freshness and depeg. A quote older than the ceiling (or stamped in the future,
// which means somebody's clock is wrong) is a DENY: stale data must never become an ALLOW (I5).
//
// The depeg check applies to the kinds that take ON exposure to the stable — pulling it into the
// agent wallet and depositing it into a vault. The exits (`vault_withdraw`, `risk_exit`,
// `sweep_home`) are exempt: those are the actions that RESPOND to a depeg, and blocking them
// during one would be exactly backwards. `pay_recipient` is exempt because it is an outflow of an
// obligation the owner already owes.
import { SYSTEM_CEILINGS } from '@steward/shared';
import { depegBps, priceOf, quoteAgeSeconds, usdcToken } from '../units';
import { deny, pass, type Rule } from './kit';

const DEPEG_SENSITIVE = ['pull_allowance', 'vault_deposit'] as const;

export const R12: Rule = (input) => {
  if (input.proposal.kind === 'noop') return pass('R12', 'noop needs no price');

  const token = usdcToken(input.policy);
  if (!token) return deny('R12', 'policy has no USDC token');
  const price = priceOf(input, token.address);
  if (!price.ok) return deny('R12', price.error);
  const { quote, demoFallback } = price.value;

  const age = quoteAgeSeconds(quote, input.now);
  if (age < 0) return deny('R12', `price for ${token.symbol} is stamped ${-age}s in the future`);
  if (age > SYSTEM_CEILINGS.PRICE_MAX_AGE_SEC)
    return deny('R12', `price for ${token.symbol} is ${age}s old (max ${SYSTEM_CEILINGS.PRICE_MAX_AGE_SEC}s)`);

  if (DEPEG_SENSITIVE.some((k) => k === input.proposal.kind)) {
    const off = depegBps(quote);
    if (off > BigInt(input.policy.depegThresholdBps))
      return deny(
        'R12',
        `${token.symbol} is ${off} bps off $1.00, over the depeg threshold ${input.policy.depegThresholdBps}`,
      );
  }
  return pass(
    'R12',
    `price is ${age}s old and within the depeg threshold${demoFallback ? ' (DEMO parity fallback)' : ''}`,
  );
};
