// Trust-boundary tests for the spend-permission routes: what the client is allowed to influence,
// and the prepare → sign → store round trip staying byte-identical.
import { describe, expect, it } from 'vitest';
import { getAddress, hashTypedData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { SYSTEM_CEILINGS } from '@steward/shared';
import {
  buildSpendPermission,
  parseSpendPermission,
  prepareTypedData,
  serializeSpendPermission,
  spendPermissionHash,
  validateSpendPermission,
} from '@steward/wallet';
import { zPrepareBody, zStoreBody } from '../lib/walletSchemas';

const OWNER = getAddress('0x7a4b704703A90D6e7bc7c89AD166Da405Ced3C8C');
const AGENT = getAddress('0xe77C2DcC31444d4D822501B10e58Aa4ab39D8a14');
const USDC = getAddress('0x036CbD53842c5426634e7929541eC2318f3dCF7e');
const MANAGER = getAddress('0xf85210B21cC50302F477BA56686d2019dC9b67Ad');
const ATTACKER = getAddress('0x3333333333333333333333333333333333333333');
const NOW = 1_800_000_000;

const goodBody = { allowance: '10000000', periodSeconds: 86_400, end: NOW + 86_400 };

describe('POST /api/spend-permission/prepare — request body', () => {
  it('accepts the owner-controllable terms only', () => {
    const r = zPrepareBody.safeParse(goodBody);
    expect(r.success).toBe(true);
    expect(r.success && r.data.allowance).toBe(10_000_000n);
  });

  it.each(['account', 'spender', 'token', 'salt', 'extraData'])(
    'rejects a client-supplied %s (the server chooses it)',
    (field) => {
      expect(zPrepareBody.safeParse({ ...goodBody, [field]: ATTACKER }).success).toBe(false);
    },
  );

  it('rejects float or negative terms', () => {
    expect(zPrepareBody.safeParse({ ...goodBody, periodSeconds: 1.5 }).success).toBe(false);
    expect(zPrepareBody.safeParse({ ...goodBody, periodSeconds: -1 }).success).toBe(false);
    expect(zPrepareBody.safeParse({ ...goodBody, allowance: '1.5' }).success).toBe(false);
  });
});

describe('POST /api/spend-permission — request body', () => {
  it('requires a hex signature', () => {
    expect(zStoreBody.safeParse({ permission: {}, signature: 'not-hex' }).success).toBe(false);
    expect(zStoreBody.safeParse({ permission: {}, signature: '0xabcd' }).success).toBe(true);
  });

  it('rejects extra fields (e.g. a smuggled walletId)', () => {
    expect(
      zStoreBody.safeParse({ permission: {}, signature: '0xabcd', walletId: 'other' }).success,
    ).toBe(false);
  });
});

describe('prepare → sign → store round trip', () => {
  /** What the prepare route builds, with the two addresses taken from the session, not the body. */
  const permission = buildSpendPermission({
    account: OWNER,
    spender: AGENT,
    token: USDC,
    allowance: 10_000_000n,
    periodSeconds: 86_400,
    start: NOW,
    end: NOW + 86_400,
    salt: 0xdeadbeefn,
  });

  it('the wire form parses back to exactly the same permission', () => {
    const wire = JSON.parse(JSON.stringify(serializeSpendPermission(permission)));
    const back = parseSpendPermission(wire);
    expect(back.ok && back.value).toEqual(permission);
  });

  it('the hash the client signs is the hash the server stores', async () => {
    const wire = JSON.parse(JSON.stringify(serializeSpendPermission(permission)));
    const back = parseSpendPermission(wire);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const td = prepareTypedData(back.value, 84532, MANAGER);
    expect(hashTypedData(td)).toBe(spendPermissionHash(permission, 84532, MANAGER));

    // and a signature over the round-tripped payload still verifies against the original
    const signer = privateKeyToAccount(`0x${'44'.repeat(32)}`);
    const sig = await signer.signTypedData(prepareTypedData(permission, 84532, MANAGER));
    expect(await signer.signTypedData(td)).toBe(sig);
  });

  it('a permission posted for someone else’s treasury or spender is rejected', () => {
    const constraints = {
      ownerAddress: OWNER,
      agentWalletAddress: AGENT,
      usdcAddress: USDC,
      now: NOW,
    };
    expect(validateSpendPermission(permission, constraints).ok).toBe(true);
    expect(validateSpendPermission({ ...permission, account: ATTACKER }, constraints).ok).toBe(
      false,
    );
    expect(validateSpendPermission({ ...permission, spender: ATTACKER }, constraints).ok).toBe(
      false,
    );
    expect(validateSpendPermission({ ...permission, token: ATTACKER }, constraints).ok).toBe(false);
    expect(
      validateSpendPermission(
        { ...permission, allowance: SYSTEM_CEILINGS.MAX_SPEND_PERMISSION_ALLOWANCE_MICRO_USD + 1n },
        constraints,
      ).ok,
    ).toBe(false);
  });
});
