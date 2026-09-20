// AGENTKIT_INTEGRATION §2 — wallet-provider bootstrap.
//
// I3: the `agentkit` instance is NEVER handed to an LLM tool-calling framework. Nothing in this repo
// imports @coinbase/agentkit-langchain or -vercel-ai-sdk, and `check:arch` forbids packages/wallet
// from importing packages/reasoning at all.
import {
  AgentKit,
  CdpSmartWalletProvider,
  erc20ActionProvider,
  walletActionProvider,
  type Action,
} from '@coinbase/agentkit';
import type { CdpClient, EvmServerAccount } from '@coinbase/cdp-sdk';
import { createLogger, err, ok, type Result } from '@steward/shared';
import { assertChainAllowed, CDP_NETWORK_ID } from './chain';

const log = createLogger('wallet');

/**
 * D-1 — AgentKit fires an un-awaited telemetry POST to cca-lite.coinbase.com when a wallet provider is
 * created. A non-2xx response becomes an unhandledRejection, which terminates Node 22. There is no
 * opt-out flag in 0.10.4, so every process that builds a wallet provider installs this logger.
 * It logs (never swallows silently) and is idempotent.
 */
let rejectionLoggerInstalled = false;
export function installUnhandledRejectionLogger(): void {
  if (rejectionLoggerInstalled) return;
  rejectionLoggerInstalled = true;
  process.on('unhandledRejection', (reason) =>
    log.error({ reason: String(reason) }, 'unhandledRejection (see D-1: AgentKit telemetry)'),
  );
}

/**
 * Action names this codebase relies on. Per D-2 Steward encodes its own value-moving calls (exact
 * bigints, ERC-4626), so this list is intentionally short: it exists as a startup drift detector, so
 * a renamed or dropped AgentKit provider fails at boot instead of at the first live decision.
 */
export const REQUIRED_ACTION_NAMES = [
  'WalletActionProvider_get_wallet_details',
  'ERC20ActionProvider_get_balance',
] as const;

export type ActionIndex = ReadonlyMap<string, Action>;

export function indexActions(actions: readonly Action[]): ActionIndex {
  return new Map(actions.map((a) => [a.name, a]));
}

export function assertActionsExist(
  index: ActionIndex,
  required: readonly string[] = REQUIRED_ACTION_NAMES,
): Result<true> {
  const missing = required.filter((n) => !index.has(n));
  return missing.length ? err(`AgentKit actions missing: ${missing.join(', ')}`) : ok(true);
}

export type BuildAgentKitInput = {
  cdp: { apiKeyId: string; apiKeySecret: string; walletSecret: string };
  chainId: number;
  allowMainnet: boolean;
  rpcUrl?: string | undefined;
  paymasterUrl?: string | undefined;
  /** Existing wallet reference (D-3): the CDP owner account and the smart account's name. */
  owner: EvmServerAccount;
  smartAccountName: string;
};

export type AgentKitBundle = {
  agentkit: AgentKit;
  walletProvider: CdpSmartWalletProvider;
  actions: ActionIndex;
};

/**
 * Build the AgentKit bundle for an already-provisioned agent wallet.
 * Provisioning (creating the named CDP accounts) is `provisionAgentWallet` — this only reloads.
 */
export async function buildAgentKit(input: BuildAgentKitInput): Promise<Result<AgentKitBundle>> {
  const chain = assertChainAllowed({ chainId: input.chainId, allowMainnet: input.allowMainnet });
  if (!chain.ok) return err(chain.error);
  const networkId = CDP_NETWORK_ID[input.chainId];
  if (!networkId) return err(`no CDP network id for chain ${input.chainId}`);

  installUnhandledRejectionLogger();

  const walletProvider = await CdpSmartWalletProvider.configureWithWallet({
    apiKeyId: input.cdp.apiKeyId,
    apiKeySecret: input.cdp.apiKeySecret,
    walletSecret: input.cdp.walletSecret,
    networkId,
    owner: input.owner,
    smartAccountName: input.smartAccountName,
    ...(input.rpcUrl ? { rpcUrl: input.rpcUrl } : {}),
    ...(input.paymasterUrl ? { paymasterUrl: input.paymasterUrl } : {}),
  });

  const agentkit = await AgentKit.from({
    walletProvider,
    // No morpho/pyth/x402 providers: D-2 (we encode ERC-4626 ourselves) and V-13 (Pyth returned 400/401).
    actionProviders: [walletActionProvider(), erc20ActionProvider()],
  });
  const actions = indexActions(agentkit.getActions());
  const present = assertActionsExist(actions);
  if (!present.ok) return err(present.error);

  log.info(
    { agentWallet: walletProvider.getAddress(), networkId, actions: actions.size },
    'agentkit ready',
  );
  return ok({ agentkit, walletProvider, actions });
}

/** Narrow the CDP client surface this package uses, so tests can supply a tiny fake. */
export type CdpAccounts = Pick<CdpClient['evm'], 'getOrCreateAccount' | 'getOrCreateSmartAccount'>;
