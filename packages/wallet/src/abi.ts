// Minimal, hand-vendored ABIs. Only the functions Steward actually calls are here, so a typo or an
// upstream change cannot silently widen what this package can encode.
//
// SpendPermissionManager: @coinbase/cdp-sdk does NOT export its ABI from a public entry point
// (the spikes had to reach into `_cjs/spend-permissions/constants.js`). Reaching into a package's
// internals from product code would break on any patch release, so the fragments below are copied
// verbatim from that file and cross-checked against it in test/abi.test.ts.
// Manager address + EIP-712 domain: docs/addresses.md, verified in Phase 0 (V-05).

const SPEND_PERMISSION_TUPLE = {
  name: 'spendPermission',
  type: 'tuple',
  internalType: 'struct SpendPermissionManager.SpendPermission',
  components: [
    { name: 'account', type: 'address', internalType: 'address' },
    { name: 'spender', type: 'address', internalType: 'address' },
    { name: 'token', type: 'address', internalType: 'address' },
    { name: 'allowance', type: 'uint160', internalType: 'uint160' },
    { name: 'period', type: 'uint48', internalType: 'uint48' },
    { name: 'start', type: 'uint48', internalType: 'uint48' },
    { name: 'end', type: 'uint48', internalType: 'uint48' },
    { name: 'salt', type: 'uint256', internalType: 'uint256' },
    { name: 'extraData', type: 'bytes', internalType: 'bytes' },
  ],
} as const;

export const SPEND_PERMISSION_MANAGER_ABI = [
  {
    type: 'function',
    name: 'approveWithSignature',
    stateMutability: 'nonpayable',
    inputs: [SPEND_PERMISSION_TUPLE, { name: 'signature', type: 'bytes', internalType: 'bytes' }],
    outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
  },
  {
    type: 'function',
    name: 'spend',
    stateMutability: 'nonpayable',
    inputs: [SPEND_PERMISSION_TUPLE, { name: 'value', type: 'uint160', internalType: 'uint160' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'revoke',
    stateMutability: 'nonpayable',
    inputs: [SPEND_PERMISSION_TUPLE],
    outputs: [],
  },
  {
    type: 'function',
    name: 'revokeAsSpender',
    stateMutability: 'nonpayable',
    inputs: [SPEND_PERMISSION_TUPLE],
    outputs: [],
  },
  {
    type: 'function',
    name: 'getCurrentPeriod',
    stateMutability: 'view',
    inputs: [SPEND_PERMISSION_TUPLE],
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'struct SpendPermissionManager.PeriodSpend',
        components: [
          { name: 'start', type: 'uint48', internalType: 'uint48' },
          { name: 'end', type: 'uint48', internalType: 'uint48' },
          { name: 'spend', type: 'uint160', internalType: 'uint160' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'getHash',
    stateMutability: 'view',
    inputs: [SPEND_PERMISSION_TUPLE],
    outputs: [{ name: '', type: 'bytes32', internalType: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'isApproved',
    stateMutability: 'view',
    inputs: [SPEND_PERMISSION_TUPLE],
    outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
  },
  {
    type: 'function',
    name: 'isRevoked',
    stateMutability: 'view',
    inputs: [SPEND_PERMISSION_TUPLE],
    outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
  },
  {
    type: 'function',
    name: 'isValid',
    stateMutability: 'view',
    inputs: [SPEND_PERMISSION_TUPLE],
    outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
  },
] as const;

/** ERC-20: only the writes/reads Steward needs. No `increaseAllowance`, no infinite-approval helpers. */
export const ERC20_ABI = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
] as const;

/** ERC-4626 vault (MockVault on testnet, a real vault on mainnet). Exact-bigint calls, per D-2. */
export const ERC4626_ABI = [
  {
    type: 'function',
    name: 'asset',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'totalAssets',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'convertToAssets',
    stateMutability: 'view',
    inputs: [{ name: 'shares', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'convertToShares',
    stateMutability: 'view',
    inputs: [{ name: 'assets', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'maxWithdraw',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'assets', type: 'uint256' },
      { name: 'receiver', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'assets', type: 'uint256' },
      { name: 'receiver', type: 'address' },
      { name: 'owner', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'redeem',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'shares', type: 'uint256' },
      { name: 'receiver', type: 'address' },
      { name: 'owner', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

/** MockPriceFeed (testnet demo oracle, V-13 fallback). Read-only from product code. */
export const MOCK_PRICE_FEED_ABI = [
  {
    type: 'function',
    name: 'latestPrice',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'microUsd_', type: 'uint256' },
      { name: 'updatedAt_', type: 'uint256' },
    ],
  },
] as const;
