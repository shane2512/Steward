// V-05/V-10 spike: a REAL Coinbase Smart Wallet (viem toCoinbaseSmartAccount) owned by a local key signs the SpendPermission.
// Exercises ERC-1271/6492 signature wrapping + on-chain approveWithSignature, no UI wallet needed. Throwaway.
import { config } from "dotenv";
import { CdpClient } from "@coinbase/cdp-sdk";
import { createWalletClient, parseAbi, createPublicClient, http, encodeFunctionData, erc20Abi, getAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { toCoinbaseSmartAccount } from "viem/account-abstraction";
import { baseSepolia } from "viem/chains";
config({ path: "../.env.local", quiet: true });
process.on("unhandledRejection", () => {});
const c: any = await import("./node_modules/@coinbase/cdp-sdk/_cjs/spend-permissions/constants.js");
const ABI = c.SPEND_PERMISSION_MANAGER_ABI, MGR = c.SPEND_PERMISSION_MANAGER_ADDRESS;
const USDC = getAddress("0x036CbD53842c5426634e7929541eC2318f3dCF7e");
const pc = createPublicClient({ chain: baseSepolia, transport: http(process.env.RPC_URL_BASE_SEPOLIA) });
const cdp = new CdpClient({ apiKeyId: process.env.CDP_API_KEY_ID, apiKeySecret: process.env.CDP_API_KEY_SECRET, walletSecret: process.env.CDP_WALLET_SECRET });
const agentOwner = await cdp.evm.getOrCreateAccount({ name: "steward-spike-owner" });
const agent = await cdp.evm.getOrCreateSmartAccount({ name: "steward-spike", owner: agentOwner });
const owner = privateKeyToAccount(generatePrivateKey()); // ephemeral, never printed/stored
const sw = await toCoinbaseSmartAccount({ client: pc, owners: [owner], version: "1.1" });
console.log("Coinbase Smart Wallet (counterfactual):", sw.address, "| deployed:", !!(await pc.getCode({ address: sw.address })));
const bal = async (a: `0x${string}`) => (await pc.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [a] })) as bigint;
const f = await cdp.evm.requestFaucet({ address: sw.address, network: "base-sepolia", token: "usdc" });
console.log("USDC faucet tx:", f.transactionHash);
for (let i = 0; i < 20 && (await bal(sw.address)) < 1_000_000n; i++) await new Promise((r) => setTimeout(r, 3000));
console.log("smart wallet USDC:", (await bal(sw.address)).toString());

// Owner EOA pays gas: deploy the wallet via its factory, then add the manager as an owner (what the Smart Wallet popup does).
await cdp.evm.requestFaucet({ address: owner.address, network: "base-sepolia", token: "eth" });
for (let i = 0; i < 20 && (await pc.getBalance({ address: owner.address })) === 0n; i++) await new Promise((r) => setTimeout(r, 3000));
const wc = createWalletClient({ account: owner, chain: baseSepolia, transport: http(process.env.RPC_URL_BASE_SEPOLIA) });
const f0 = await sw.getFactoryArgs();
const h1 = await wc.sendTransaction({ to: f0.factory!, data: f0.factoryData! }); await pc.waitForTransactionReceipt({ hash: h1 });
console.log("deployed via factory:", h1, !!(await pc.getCode({ address: sw.address })));
const h2 = await wc.sendTransaction({ to: sw.address, data: encodeFunctionData({ abi: parseAbi(["function addOwnerAddress(address owner)"]), functionName: "addOwnerAddress", args: [MGR] }) }); await pc.waitForTransactionReceipt({ hash: h2 });
console.log("manager added as owner:", h2);
const perm = { account: sw.address, spender: agent.address, token: USDC, allowance: 5_000_000n, period: 86400, start: Math.floor(Date.now() / 1000) - 60, end: Math.floor(Date.now() / 1000) + 3600, salt: BigInt(Date.now()), extraData: "0x" as const };
const sig = await sw.signTypedData({ domain: { name: "Spend Permission Manager", version: "1", chainId: 84532, verifyingContract: MGR },
  types: { SpendPermission: [{ name: "account", type: "address" }, { name: "spender", type: "address" }, { name: "token", type: "address" }, { name: "allowance", type: "uint160" }, { name: "period", type: "uint48" }, { name: "start", type: "uint48" }, { name: "end", type: "uint48" }, { name: "salt", type: "uint256" }, { name: "extraData", type: "bytes" }] },
  primaryType: "SpendPermission", message: perm });
console.log("signature hex chars:", sig.length, "(65-byte EOA would be 132) | 6492 wrapped:", sig.endsWith("6492649264926492649264926492649264926492649264926492649264926492"));
console.log("V-10 viem verifyTypedData (undeployed smart wallet, ERC-6492):", await pc.verifyTypedData({ address: sw.address, signature: sig,
  domain: { name: "Spend Permission Manager", version: "1", chainId: 84532, verifyingContract: MGR },
  types: { SpendPermission: [{ name: "account", type: "address" }, { name: "spender", type: "address" }, { name: "token", type: "address" }, { name: "allowance", type: "uint160" }, { name: "period", type: "uint48" }, { name: "start", type: "uint48" }, { name: "end", type: "uint48" }, { name: "salt", type: "uint256" }, { name: "extraData", type: "bytes" }] },
  primaryType: "SpendPermission", message: perm }));

const send = async (data: `0x${string}`) => { const op = await cdp.evm.sendUserOperation({ smartAccount: agent, network: "base-sepolia", calls: [{ to: MGR, data, value: 0n }] }); return cdp.evm.waitForUserOperation({ smartAccountAddress: agent.address, userOpHash: op.userOpHash }) as any; };
const r1 = await send(encodeFunctionData({ abi: ABI, functionName: "approveWithSignature", args: [perm, sig] }));
console.log("approveWithSignature:", r1.status, r1.transactionHash ?? "");
console.log("isApproved:", await pc.readContract({ address: MGR, abi: ABI, functionName: "isApproved", args: [perm] }));
const r2 = await send(encodeFunctionData({ abi: ABI, functionName: "spend", args: [perm, 1_000_000n] }));
console.log("spend 1 USDC:", r2.status, r2.transactionHash ?? "", "| smart wallet USDC:", (await bal(sw.address)).toString(), "| deployed now:", !!(await pc.getCode({ address: sw.address })));
