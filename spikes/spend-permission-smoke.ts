// V-05 + V-10 spike (throwaway). Stage "spend": verify sig, approve on-chain, spend 1 USDC. Stage "postrevoke": confirm revoked and spend fails.
import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { CdpClient } from "@coinbase/cdp-sdk";
import { createPublicClient, http, encodeFunctionData, erc20Abi, getAddress } from "viem";
import { baseSepolia } from "viem/chains";
config({ path: "../.env.local", quiet: true });
process.on("unhandledRejection", () => {});
const c: any = await import("./node_modules/@coinbase/cdp-sdk/_cjs/spend-permissions/constants.js");
const ABI = c.SPEND_PERMISSION_MANAGER_ABI, MGR = c.SPEND_PERMISSION_MANAGER_ADDRESS;
const USDC = getAddress("0x036CbD53842c5426634e7929541eC2318f3dCF7e");
const pc = createPublicClient({ chain: baseSepolia, transport: http(process.env.RPC_URL_BASE_SEPOLIA) });
const cdp = new CdpClient({ apiKeyId: process.env.CDP_API_KEY_ID, apiKeySecret: process.env.CDP_API_KEY_SECRET, walletSecret: process.env.CDP_WALLET_SECRET });
const owner = await cdp.evm.getOrCreateAccount({ name: "steward-spike-owner" });
const sa = await cdp.evm.getOrCreateSmartAccount({ name: "steward-spike", owner });
const stage = process.argv[2] ?? "spend";
const bal = async (a: `0x${string}`) => (await pc.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [a] })) as bigint;

if (stage === "verify-msg" || stage === "spend") {
  const m = JSON.parse(readFileSync(".msg.json", "utf8"));
  const ok = await pc.verifyMessage({ address: m.account, message: m.message, signature: m.sig });
  console.log("V-10 viem verifyMessage (smart wallet, 6492/1271):", ok);
  if (stage === "verify-msg") process.exit(0);
}
const { permission: p, sig } = JSON.parse(readFileSync(".perm.json", "utf8"));
const perm = { ...p, allowance: BigInt(p.allowance), salt: BigInt(p.salt) };
const send = async (calls: { to: `0x${string}`; data: `0x${string}` }[]) => {
  const op = await cdp.evm.sendUserOperation({ smartAccount: sa, network: "base-sepolia", calls: calls.map((x) => ({ ...x, value: 0n })) });
  const r = await cdp.evm.waitForUserOperation({ smartAccountAddress: sa.address, userOpHash: op.userOpHash });
  return r;
};
if (stage === "spend") {
  console.log("isApproved before:", await pc.readContract({ address: MGR, abi: ABI, functionName: "isApproved", args: [perm] }));
  console.log("approveWithSignature:", JSON.stringify(await send([{ to: MGR, data: encodeFunctionData({ abi: ABI, functionName: "approveWithSignature", args: [perm, sig] }) }]), (_, v) => (typeof v === "bigint" ? v.toString() : v)).slice(0, 300));
  console.log("isApproved after:", await pc.readContract({ address: MGR, abi: ABI, functionName: "isApproved", args: [perm] }), "| isValid:", await pc.readContract({ address: MGR, abi: ABI, functionName: "isValid", args: [perm] }));
  console.log("agent USDC before:", (await bal(sa.address)).toString(), "| owner:", (await bal(p.account)).toString());
  const r = await send([{ to: MGR, data: encodeFunctionData({ abi: ABI, functionName: "spend", args: [perm, 1_000_000n] }) }]);
  console.log("spend 1 USDC:", (r as any).status, (r as any).transactionHash);
  console.log("agent USDC after:", (await bal(sa.address)).toString(), "| owner:", (await bal(p.account)).toString());
  console.log("getCurrentPeriod:", JSON.stringify(await pc.readContract({ address: MGR, abi: ABI, functionName: "getCurrentPeriod", args: [perm] }), (_, v) => (typeof v === "bigint" ? v.toString() : v)));
}
if (stage === "postrevoke") {
  console.log("isRevoked:", await pc.readContract({ address: MGR, abi: ABI, functionName: "isRevoked", args: [perm] }), "| isValid:", await pc.readContract({ address: MGR, abi: ABI, functionName: "isValid", args: [perm] }));
  try { const r = await send([{ to: MGR, data: encodeFunctionData({ abi: ABI, functionName: "spend", args: [perm, 1_000_000n] }) }]); console.log("POST-REVOKE SPEND UNEXPECTEDLY:", (r as any).status); }
  catch (e: any) { console.log("post-revoke spend rejected as expected:", String(e?.message ?? e).slice(0, 200)); }
}
