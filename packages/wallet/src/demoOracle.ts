// 6.5 (demo only) — re-publish the MockPriceFeed quote so R12's 60 s freshness rule can pass on
// stage. Phase 5's live run found the mock quote 41,828 s old; without this the demo would fail
// closed on every priced action, which is correct behaviour and a terrible demo.
//
// This is the THIRD (and last) place in product code that can broadcast, after
// `executor.ts:send` and `spendPermission.ts:ensureApprovedOnchain`. It is fenced so hard that it
// cannot become anything else:
//
//   * refused at construction unless DEMO_MODE **and** chainId 84532 (I11) — same fence as
//     `mockPriceFeedAdapter`;
//   * it encodes exactly one function, `setPrice(uint256)`, from a hard-coded 1-entry ABI;
//   * the only target is the MockPriceFeed address it was constructed with;
//   * `value` is always 0 and the sender is the demo admin CDP server account, which holds no
//     owner funds and is not the agent wallet;
//   * it moves no tokens and touches no policy, receipt, execution or ledger row.
//
// It deliberately does NOT go through the Policy Engine: there is no proposal here and no money
// moves. Writing a price is an oracle-operator action, and pretending otherwise would put a
// non-proposal on the executor path, which is exactly what PHASES 6 "Do not" forbids.
import { encodeFunctionData, getAddress } from 'viem';
import { err, ok, type Address, type Hex, type Result } from '@steward/shared';

/** Same fence as `packages/risk/src/oracle.ts`. */
export const BASE_SEPOLIA = 84532;

const SET_PRICE_ABI = [
  {
    type: 'function',
    name: 'setPrice',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'microUsd_', type: 'uint256' }],
    outputs: [],
  },
] as const;

/** The narrow CDP surface this needs: one server-account transaction. */
export type CdpDemoAdmin = {
  getOrCreateAccount(input: { name: string }): Promise<{ address: string }>;
  sendTransaction(input: {
    address: Address;
    network: 'base-sepolia';
    transaction: { to: Address; data: Hex; value: bigint };
  }): Promise<{ transactionHash: string }>;
};

export type DemoPriceRefresher = {
  readonly feed: Address;
  /** Publish `microUsd` with `updatedAt = block.timestamp`. Returns the tx hash. */
  setPrice(microUsd: bigint): Promise<Result<Hex>>;
};

export type DemoPriceRefresherOptions = {
  cdp: CdpDemoAdmin;
  /** CDP server account that owns the MockPriceFeed (`steward-demo-admin`, docs/addresses.md). */
  adminAccountName: string;
  feed: Address;
  chainId: number;
  demoMode: boolean;
};

/**
 * Build the demo price refresher, or `Err` if the I11 fence does not hold. Constructed once at
 * worker boot so a misconfigured deployment fails at startup, never at the first tick.
 */
export function demoPriceRefresher(options: DemoPriceRefresherOptions): Result<DemoPriceRefresher> {
  if (!options.demoMode) return err('demo price refresh requires DEMO_MODE=true (I11)');
  if (options.chainId !== BASE_SEPOLIA)
    return err(`demo price refresh is only allowed on chain ${BASE_SEPOLIA} (I11)`);

  const feed = getAddress(options.feed);

  return ok({
    feed,
    async setPrice(microUsd: bigint): Promise<Result<Hex>> {
      if (microUsd <= 0n) return err('price must be positive');
      try {
        const admin = await options.cdp.getOrCreateAccount({ name: options.adminAccountName });
        const { transactionHash } = await options.cdp.sendTransaction({
          address: getAddress(admin.address),
          network: 'base-sepolia',
          transaction: {
            to: feed,
            data: encodeFunctionData({
              abi: SET_PRICE_ABI,
              functionName: 'setPrice',
              args: [microUsd],
            }),
            value: 0n,
          },
        });
        return ok(transactionHash as Hex);
      } catch (e) {
        return err(`demo setPrice failed: ${String(e)}`);
      }
    },
  });
}
