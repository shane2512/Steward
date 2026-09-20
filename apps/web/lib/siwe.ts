// SIWE verification core (Phase 1.8). No I/O except the injected signature verifier, so it is unit-testable.
// Prod verifier = viem publicClient.verifyMessage (ERC-1271 / ERC-6492 aware, V-10). Only EOAs are tested so far.
// TODO(D-5, PROPOSED): reject plain-EOA wallets at onboarding (Coinbase Smart Wallet only). NOT implemented.
import { getAddress, type Address, type Hex } from 'viem';
import { parseSiweMessage, validateSiweMessage } from 'viem/siwe';
import { err, ok, type Result } from '@steward/shared';

export const NONCE_TTL_MS = 5 * 60 * 1000;

export type SignatureVerifier = (a: {
  address: Address;
  message: string;
  signature: Hex;
}) => Promise<boolean>;

export type SiweCheck = {
  message: string;
  signature: Hex;
  expectedNonce: string | undefined;
  nonceIssuedAt: number | undefined; // epoch ms, from the session
  domain: string;
  chainId: number;
  now: Date;
  verify: SignatureVerifier;
};

export async function verifySiwe(c: SiweCheck): Promise<Result<Address, string>> {
  if (!c.expectedNonce || c.nonceIssuedAt === undefined)
    return err('no nonce issued for this session');
  if (c.now.getTime() - c.nonceIssuedAt > NONCE_TTL_MS) return err('nonce expired');
  const msg = parseSiweMessage(c.message);
  if (!msg.address || !msg.nonce) return err('malformed SIWE message');
  if (msg.chainId !== c.chainId) return err('wrong chain');
  if (
    !validateSiweMessage({ message: msg, domain: c.domain, nonce: c.expectedNonce, time: c.now })
  ) {
    return err('SIWE message failed validation (domain, nonce or time)');
  }
  const address = getAddress(msg.address);
  let valid: boolean;
  try {
    valid = await c.verify({ address, message: c.message, signature: c.signature });
  } catch {
    valid = false; // RPC failure fails closed (I5)
  }
  return valid ? ok(address) : err('invalid signature');
}
