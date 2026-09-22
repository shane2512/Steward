// Phase 7 addendum — which address becomes the treasury, decided from the SIWE signature's shape.
//
// The dangerous direction is trusting an EOA as the treasury: the spend permission would be
// ungrantable and the sweep-home destination would be an account the owner's key controls but the
// SpendPermissionManager can never be an owner of. The safe direction is deriving a companion that
// nobody has funded yet. Every case below is asserted in that light.
import { describe, expect, it } from 'vitest';
import {
  createPublicClient,
  custom,
  getAddress,
  keccak256,
  type Hex,
  type PublicClient,
} from 'viem';
import { baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { resolveTreasuryAddress } from '../lib/treasury';

const owner = privateKeyToAccount(`0x${'42'.repeat(32)}` as Hex);
const EOA_SIG = `0x${'11'.repeat(65)}` as Hex;
const SIG_6492 =
  `0x${'22'.repeat(200)}6492649264926492649264926492649264926492649264926492649264926492` as Hex;

/** Answers the factory read deterministically; `getCode` says whether the signer has code. */
function client(opts: { code: Hex | undefined; callThrows?: boolean }): PublicClient {
  const base = createPublicClient({
    chain: baseSepolia,
    transport: custom({
      request: async ({ method, params }) => {
        if (opts.callThrows) throw new Error('rpc down');
        if (method !== 'eth_call') throw new Error(`unexpected RPC: ${method}`);
        return keccak256((params as [{ data: Hex }])[0].data);
      },
    }),
  });
  return {
    ...base,
    getCode: async () => {
      if (opts.code === undefined && opts.callThrows) throw new Error('rpc down');
      return opts.code;
    },
  } as unknown as PublicClient;
}

describe('resolveTreasuryAddress', () => {
  it('a deployed contract wallet IS the treasury (existing behaviour, untouched)', async () => {
    const r = await resolveTreasuryAddress(client({ code: '0x6080' }), {
      ownerAddress: owner.address,
      siweSignature: EOA_SIG,
    });
    expect(r.ok && r.value).toEqual({ address: getAddress(owner.address), derived: false });
  });

  it('a counterfactual smart wallet (ERC-6492 signature) IS the treasury', async () => {
    const r = await resolveTreasuryAddress(client({ code: '0x' }), {
      ownerAddress: owner.address,
      siweSignature: SIG_6492,
    });
    expect(r.ok && r.value).toEqual({ address: getAddress(owner.address), derived: false });
  });

  it('a plain EOA gets a DERIVED companion treasury, never itself', async () => {
    const r = await resolveTreasuryAddress(client({ code: '0x' }), {
      ownerAddress: owner.address,
      siweSignature: EOA_SIG,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.derived).toBe(true);
    expect(r.value.address).not.toBe(getAddress(owner.address));
    expect(r.value.address).toBe(getAddress(r.value.address));
  });

  it('resolves the same EOA to the same treasury every time (idempotency)', async () => {
    const again = async () =>
      resolveTreasuryAddress(client({ code: '0x' }), {
        ownerAddress: owner.address,
        siweSignature: EOA_SIG,
      });
    const [a, b] = await Promise.all([again(), again()]);
    expect(a.ok && b.ok && a.value.address === b.value.address).toBe(true);
  });

  it('fails closed when the chain cannot be read (I5)', async () => {
    const r = await resolveTreasuryAddress(client({ code: undefined, callThrows: true }), {
      ownerAddress: owner.address,
      siweSignature: EOA_SIG,
    });
    expect(r.ok).toBe(false);
  });
});
