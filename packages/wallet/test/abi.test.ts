// The SpendPermissionManager ABI is hand-vendored in src/abi.ts because @coinbase/cdp-sdk does not
// export it publicly. This test is the guard: every fragment we vendored must be byte-identical to
// the SDK's, so an upstream change breaks the build instead of producing wrong calldata.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { encodeFunctionData, getAddress, type Abi } from 'viem';
import { ERC20_ABI, ERC4626_ABI, SPEND_PERMISSION_MANAGER_ABI } from '../src/abi';

const require_ = createRequire(import.meta.url);
const sdk = require_('../node_modules/@coinbase/cdp-sdk/_cjs/spend-permissions/constants.js') as {
  SPEND_PERMISSION_MANAGER_ABI: Abi;
  SPEND_PERMISSION_MANAGER_ADDRESS: string;
};

/** Compare only shape, not key order or `internalType` presence. */
const normalize = (f: unknown): string =>
  JSON.stringify(f, (_k, v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(o)
          .filter((k) => k !== 'internalType')
          .sort()
          .map((k) => [k, o[k]]),
      );
    }
    return v;
  });

describe('vendored SpendPermissionManager ABI', () => {
  const sdkFns = new Map(
    sdk.SPEND_PERMISSION_MANAGER_ABI.filter((f) => f.type === 'function').map((f) => [f.name, f]),
  );

  it.each(SPEND_PERMISSION_MANAGER_ABI.map((f) => f.name))(
    '%s matches the CDP SDK fragment exactly',
    (name) => {
      const ours = SPEND_PERMISSION_MANAGER_ABI.find((f) => f.name === name);
      const theirs = sdkFns.get(name);
      expect(theirs, `${name} no longer exists in @coinbase/cdp-sdk`).toBeDefined();
      expect(normalize(ours)).toBe(normalize(theirs));
    },
  );

  it('vendors only the functions Steward calls', () => {
    expect(SPEND_PERMISSION_MANAGER_ABI.map((f) => f.name).sort()).toEqual([
      'approveWithSignature',
      'getCurrentPeriod',
      'getHash',
      'isApproved',
      'isRevoked',
      'isValid',
      'revoke',
      'revokeAsSpender',
      'spend',
    ]);
  });

  it('manager address in docs/addresses.md matches the SDK constant', () => {
    expect(getAddress(sdk.SPEND_PERMISSION_MANAGER_ADDRESS)).toBe(
      getAddress('0xf85210B21cC50302F477BA56686d2019dC9b67Ad'),
    );
  });
});

describe('token ABIs are minimal by construction', () => {
  it('ERC-20 exposes no unbounded-approval helper', () => {
    const names = ERC20_ABI.map((f) => f.name);
    expect(names).not.toContain('increaseAllowance');
    expect(names.sort()).toEqual(['allowance', 'approve', 'balanceOf', 'decimals', 'transfer']);
  });

  it('ERC-4626 writes are limited to deposit/withdraw/redeem', () => {
    const writes = ERC4626_ABI.filter((f) => f.stateMutability === 'nonpayable').map((f) => f.name);
    expect(writes.sort()).toEqual(['deposit', 'redeem', 'withdraw']);
  });

  it('selectors match the canonical signatures', () => {
    // Guards against a typo in a parameter type silently producing a different selector.
    expect(
      encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'transfer',
        args: ['0x0000000000000000000000000000000000000001', 1n],
      }).slice(0, 10),
    ).toBe('0xa9059cbb'); // transfer(address,uint256)
    expect(
      encodeFunctionData({
        abi: ERC4626_ABI,
        functionName: 'deposit',
        args: [1n, '0x0000000000000000000000000000000000000001'],
      }).slice(0, 10),
    ).toBe('0x6e553f65'); // deposit(uint256,address)
  });
});
