// R08 — runway buffer: liquid USDC (agent + treasury) after the action must still cover the
// mandate's buffer. A deposit that breaks it is a DENY (the money is merely idle, never move it);
// a payment that breaks it is an ESCALATE (payroll may legitimately eat into the buffer, but the
// owner decides).
import { liquidMicroUsd, proposalAmountMicroUsd } from '../units';
import { deny, escalate, pass, type Rule } from './kit';

export const R08: Rule = (input) => {
  const kind = input.proposal.kind;
  if (kind !== 'vault_deposit' && kind !== 'pay_recipient')
    return pass('R08', `${kind} does not reduce liquid USDC`);

  const liquid = liquidMicroUsd(input);
  if (!liquid.ok) return deny('R08', `cannot value liquid balances: ${liquid.error}`);
  const micro = proposalAmountMicroUsd(input);
  if (!micro.ok) return deny('R08', `cannot value the amount: ${micro.error}`);

  const post = liquid.value - micro.value;
  if (post >= input.policy.runwayBufferMicroUsd)
    return pass('R08', `${post} micro-USD liquid after the action, buffer is covered`);

  const message = `${post} micro-USD liquid after the action, below the runway buffer ${input.policy.runwayBufferMicroUsd}`;
  return kind === 'vault_deposit' ? deny('R08', message) : escalate('R08', message);
};
