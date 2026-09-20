// V-03/V-04/V-07 spike (throwaway). Never prints secrets.
import { config } from "dotenv";
import { CdpClient } from "@coinbase/cdp-sdk";
import { writeFileSync } from "node:fs";
import { AgentKit, CdpSmartWalletProvider, walletActionProvider, erc20ActionProvider,
  morphoActionProvider, pythActionProvider, x402ActionProvider } from "@coinbase/agentkit";
process.on("unhandledRejection", (e: any) => console.log("[unhandledRejection ignored]", e?.message));
config({ path: "../.env.local", quiet: true });

const cdp = new CdpClient({ apiKeyId: process.env.CDP_API_KEY_ID, apiKeySecret: process.env.CDP_API_KEY_SECRET, walletSecret: process.env.CDP_WALLET_SECRET });
const owner = await cdp.evm.getOrCreateAccount({ name: "steward-spike-owner" });
const sa = await cdp.evm.getOrCreateSmartAccount({ name: "steward-spike", owner });
console.log("owner server acct:", owner.address, "| smart acct:", sa.address);
const wallet = await CdpSmartWalletProvider.configureWithWallet({
  apiKeyId: process.env.CDP_API_KEY_ID, apiKeySecret: process.env.CDP_API_KEY_SECRET,
  walletSecret: process.env.CDP_WALLET_SECRET, networkId: "base-sepolia",
  owner, smartAccountName: "steward-spike", rpcUrl: process.env.RPC_URL_BASE_SEPOLIA,
});
const addr = wallet.getAddress();
console.log("V-03 smart wallet:", addr, "| network:", JSON.stringify(wallet.getNetwork()));
console.log("exportWallet:", JSON.stringify(await wallet.exportWallet()));
console.log("paymasterUrl configured:", !!wallet.getPaymasterUrl());

const agentkit = await AgentKit.from({
  walletProvider: wallet,
  actionProviders: [walletActionProvider(), erc20ActionProvider(), morphoActionProvider(),
    pythActionProvider(), x402ActionProvider()],
});
const actions = agentkit.getActions();
const dump = actions.map((a: any) => {
  let schema: any; try { schema = (a.schema as any).toJSONSchema?.() ?? Object.keys((a.schema as any).shape ?? {}); } catch { schema = "n/a"; }
  return { name: a.name, description: a.description, schema };
});
writeFileSync("../docs/agentkit-actions.json", JSON.stringify(dump, null, 2));
console.log("V-07 actions:", dump.map((d) => d.name).join(", "));

// V-04: gasless test — 0-value self-transfer, no ETH funded to this wallet.
console.log("ETH balance (wei):", (await wallet.getBalance()).toString());
const hash = await wallet.sendTransaction({ to: addr as `0x${string}`, value: 0n });
console.log("userOp hash:", hash);
const receipt = await wallet.waitForTransactionReceipt(hash);
console.log("V-04 status:", receipt?.status, "| tx:", receipt?.receipt?.transactionHash ?? receipt?.transactionHash);
