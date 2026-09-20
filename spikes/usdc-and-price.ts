// V-05(on-chain)/V-06/V-13 spike (throwaway).
import { config } from "dotenv";
import { createPublicClient, http, erc20Abi, getAddress } from "viem";
import { baseSepolia } from "viem/chains";
config({ path: "../.env.local", quiet: true });
const pc = createPublicClient({ chain: baseSepolia, transport: http(process.env.RPC_URL_BASE_SEPOLIA) });
console.log("chainId:", await pc.getChainId());
const USDC = getAddress("0x036CbD53842c5426634e7929541eC2318f3dCF7e");
const MGR = getAddress("0xf85210B21cC50302F477BA56686d2019dC9b67Ad");
const VAL = getAddress("0xcfCE48B757601F3f351CB6f434CB0517aEEE293D");
for (const [n, a] of [["USDC", USDC], ["SpendPermissionManager", MGR], ["ERC6492Validator", VAL]] as const)
  console.log(n, a, "code bytes:", ((await pc.getCode({ address: a }))?.length ?? 2) / 2 - 1);
const r = (fn: "decimals" | "symbol" | "name") => pc.readContract({ address: USDC, abi: erc20Abi, functionName: fn });
console.log("USDC:", await r("name"), await r("symbol"), await r("decimals"));
const owner = getAddress(process.env.TEST_OWNER_ADDRESS!);
console.log("owner USDC balance:", (await pc.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [owner] })).toString(),
  "| owner ETH:", (await pc.getBalance({ address: owner })).toString());
// V-13: Pyth via AgentKit action (needs a wallet provider only for network; pyth is read-only)
const { pythActionProvider } = await import("@coinbase/agentkit");
const p: any = pythActionProvider();
const feed = await p.fetchPriceFeed?.({ tokenSymbol: "USDC" }).catch((e: any) => "ERR " + e.message);
console.log("pyth feed id:", feed);
const price = await p.fetchPrice?.({ priceFeedID: typeof feed === "string" && feed.startsWith("0x") ? feed : "eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a" }).catch((e: any) => "ERR " + e.message);
console.log("pyth price:", price);
