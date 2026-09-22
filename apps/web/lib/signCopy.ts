// Plain-language copy for every way a signing flow can end (UX_FLOWS copy rules: say what happened,
// whether money moved, and what to do next).
//
// The server owns the truth about why a signature was refused; this table only translates its error
// CODE into a sentence. A code we do not recognise still gets the server's own message rather than a
// generic "something went wrong" — never invent a reason for a refusal we did not understand.
import { ApiError } from './api';
import { classifyConnectError } from './connectMachine';

export type SignError = {
  title: string;
  body: string;
  /** True when the owner can simply try again; false when something must change first. */
  retryable: boolean;
};

const REJECTED: SignError = {
  title: 'Signature not given',
  body: 'You closed the wallet request. Nothing was signed and nothing moved. You can try again when you are ready.',
  retryable: true,
};

/**
 * Per-code copy. Keys are the `error.code` values the Steward routes return (API.md error shape).
 * Everything here is a refusal BEFORE anything happened: no signing flow in Steward moves money, so
 * every message can say so truthfully.
 */
const CODES: Record<string, SignError> = {
  // --- shared ---------------------------------------------------------------------------------
  unauthorized: {
    title: 'You are signed out',
    body: 'Your session ended before this was submitted. Nothing was recorded. Sign in again and repeat the step.',
    retryable: false,
  },
  bad_signature: {
    title: 'That signature was not accepted',
    body: 'Steward checked the signature against your wallet address and it did not match. Nothing was recorded. Try signing again with the wallet you signed in with.',
    retryable: true,
  },
  verify_failed: {
    title: 'Steward could not check your signature',
    body: 'The network check did not complete, so Steward refused rather than guessing. Nothing was recorded. Try again in a moment.',
    retryable: true,
  },
  network: {
    title: 'Steward could not reach the server',
    body: 'Nothing was sent and nothing moved. Check your connection and try again.',
    retryable: true,
  },
  // --- spend permission -----------------------------------------------------------------------
  invalid_terms: {
    title: 'Those limits are outside what Steward allows',
    body: 'Steward refused the terms before asking you to sign. Nothing was granted. Lower the daily amount or shorten the end date and try again.',
    retryable: true,
  },
  bad_permission: {
    title: 'That permission did not match what you were shown',
    body: 'The signed permission did not match the one Steward prepared, so it was refused. Nothing was granted. Start the step again.',
    retryable: true,
  },
  not_provisioned: {
    title: 'Your agent wallet is not ready yet',
    body: 'Steward needs its own wallet before it can be given a limit. Nothing was granted. Go back a step and create it.',
    retryable: false,
  },
  // --- policy ---------------------------------------------------------------------------------
  no_draft: {
    title: 'There is no compiled policy to sign',
    body: 'Steward has nothing to activate. Nothing changed. Go back and compile your mandate first.',
    retryable: false,
  },
  policy_changed: {
    title: 'The policy changed while you were reading it',
    body: 'What you were about to sign is no longer the current draft, so Steward refused it. Nothing was activated. Review the new version and sign that.',
    retryable: true,
  },
  already_activated: {
    title: 'That version is already active',
    body: 'Someone activated this policy version already. Nothing changed. Reload to see the active policy.',
    retryable: false,
  },
  // --- recipients -----------------------------------------------------------------------------
  nonce_expired: {
    title: 'That confirmation expired',
    body: 'Steward only keeps a recipient confirmation for five minutes. Nothing was added. Review the address once more and sign a fresh confirmation.',
    retryable: true,
  },
  duplicate_recipient: {
    title: 'That address is already on your list',
    body: 'Nothing was added. Steward already pays this address under an existing name.',
    retryable: false,
  },
  too_many_recipients: {
    title: 'Your allowlist is full',
    body: 'Steward caps the allowlist so it stays reviewable. Nothing was added. Remove a recipient you no longer pay, then try again.',
    retryable: false,
  },
  // --- owner path: freeze / revoke / sweep (task 7.8) -------------------------------------------
  already_frozen: {
    title: 'Steward is already stopped',
    body: 'Nothing further was needed, so no signature was taken. Carry on with revoking your spending permission.',
    retryable: false,
  },
  not_frozen: {
    title: 'Freeze Steward first',
    body: 'A sweep only runs on a stopped wallet, so Steward refused. Nothing moved. Complete step one, then come back.',
    retryable: false,
  },
  no_permission: {
    title: 'There is no spending permission to revoke',
    body: 'Steward has no on-chain allowance on this wallet. Nothing changed and nothing moved.',
    retryable: false,
  },
  not_revoked_onchain: {
    title: 'The chain still shows the permission as live',
    body: 'Steward will not record a revoke it cannot see. Nothing moved. Wait for the transaction to confirm and try again.',
    retryable: true,
  },
  revoke_unconfirmed: {
    title: 'Steward did not see the revoke confirm',
    body: 'Your transaction may still be pending. Nothing moved, and Steward is still stopped. Check your wallet, then reopen this and try again.',
    retryable: true,
  },
  chain_unreadable: {
    title: 'Steward could not read the chain',
    body: 'It refused rather than guessing whether your permission is revoked. Nothing changed. Try again in a moment.',
    retryable: true,
  },
  wallet_unavailable: {
    title: "Steward's own wallet is unreachable",
    body: 'The sweep could not start, so nothing moved. Steward is still stopped and your funds are where they were. Try again in a moment.',
    retryable: true,
  },
  nothing_to_sweep: {
    title: 'There is nothing to bring home',
    body: 'Steward holds no USDC and no vault shares. Nothing moved because there was nothing to move.',
    retryable: false,
  },
  // --- approvals ------------------------------------------------------------------------------
  expired: {
    title: 'This approval expired',
    body: 'Steward only holds an approval open for 24 hours, then it lapses on its own. Nothing was done. Steward will look at this again on its next check and ask you afresh if it still applies.',
    retryable: false,
  },
  policy_version_changed: {
    title: 'Your policy changed after Steward asked',
    body: 'This request was measured against an older policy, so it was cancelled automatically rather than approved under rules you have since replaced. Nothing was done. Steward will re-check under the new policy.',
    retryable: false,
  },
  not_pending: {
    title: 'This was already decided',
    body: 'Someone approved, rejected or cancelled this already, so Steward refused a second decision. Nothing changed.',
    retryable: false,
  },
  owner_mismatch: {
    title: 'That wallet cannot approve this',
    body: 'Only the treasury owner on the policy may approve. Nothing was done. Sign in with the wallet that owns the treasury.',
    retryable: false,
  },
  no_active_policy: {
    title: 'This wallet has no active policy',
    body: 'Steward will not act without one, so it refused. Nothing was done. Sign your policy first.',
    retryable: false,
  },
  queue_unavailable: {
    title: 'Approved, but not yet handed over',
    body: 'Your approval was recorded, but Steward could not queue the work. No money moved. It will be picked up when the service recovers.',
    retryable: false,
  },
  audit_failed: {
    title: 'Steward could not write its audit record',
    body: 'Steward never acts without an audit entry, so it stopped. Nothing was recorded and nothing moved. Try again in a moment.',
    retryable: true,
  },
};

/** Map anything a signing flow can throw to honest copy. Wallet rejection is not an error state. */
export function signErrorCopy(e: unknown): SignError {
  if (e instanceof ApiError) {
    const known = CODES[e.code];
    if (known) return known;
    return {
      title: 'Steward refused this',
      // The server's own message, not an invented one.
      body: `${e.message} Nothing was recorded.`,
      retryable: e.status >= 500,
    };
  }
  if (classifyConnectError(e) === 'rejected') return REJECTED;
  return {
    title: 'That did not go through',
    body: 'Steward did not record anything and nothing moved. Try again.',
    retryable: true,
  };
}

/** True when the failure was the owner closing the wallet prompt (a choice, not a fault). */
export function isRejection(e: unknown): boolean {
  return !(e instanceof ApiError) && classifyConnectError(e) === 'rejected';
}
