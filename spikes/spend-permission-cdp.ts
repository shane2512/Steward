// V-05 fallback-B spike (throwaway): CDP-owned treasury smart account -> agent smart account. Fully server-side.
import { config } from "dotenv";
import { CdpClient } from "@coinbase/cdp-sdk";
import { createPublicClient, http, erc20Abi, getAddress, formatUnits } from "viem";
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
const tOwner = await cdp.evm.getOrCreateAccount({ name: "steward-spike-treasury-owner" });
const treasury = await cdp.evm.getOrCreateSmartAccount({ name: "steward-spike-treasury2", owner: tOwner, enableSpendPermissions: true });
const bal = async (a: `0x${string}`) => (await pc.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [a] })) as bigint;
const show = async (l: string) => console.log(l, "| treasury USDC:", formatUnits(await bal(treasury.address), 6), "| agent USDC:", formatUnits(await bal(agent.address), 6));
const wait = async (sa: any, op: any) => (await cdp.evm.waitForUserOperation({ smartAccountAddress: sa.address, userOpHash: op.userOpHash }));
console.log("treasury:", treasury.address, "| agent:", agent.address);

if ((await bal(treasury.address)) < 5_000_000n) {
  const f = await cdp.evm.requestFaucet({ address: treasury.address, network: "base-sepolia", token: "usdc" });
  console.log("USDC faucet tx:", f.transactionHash);
  for (let i = 0; i < 20 && (await bal(treasury.address)) < 1_000_000n; i++) await new Promise((r) => setTimeout(r, 3000));
}
await show("start");

const op = await cdp.evm.createSpendPermission({ network: "base-sepolia",
  spendPermission: { account: treasury.address, spender: agent.address, token: "usdc", allowance: 5_000_000n, period: 86400, start: new Date(Date.now() - 60_000), end: new Date(Date.now() + 3600_000) } });
const r1: any = await wait(treasury, op);
console.log("createSpendPermission (owner-approved on-chain):", r1.status, r1.transactionHash ?? r1.userOpHash);
const list = await cdp.evm.listSpendPermissions({ address: treasury.address });
const sp: any = list.spendPermissions.at(-1);
console.log("permission hash:", sp.permissionHash, "| revoked:", sp.revoked);
const perm = { ...sp.permission, allowance: BigInt(sp.permission.allowance), salt: BigInt(sp.permission.salt), period: Number(sp.permission.period), start: Number(sp.permission.start), end: Number(sp.permission.end) };
console.log("onchain isApproved:", await pc.readContract({ address: MGR, abi: ABI, functionName: "isApproved", args: [perm] }));

const spend: any = await agent.useSpendPermission({ spendPermission: perm, value: 1_000_000n, network: "base-sepolia" });
const r2: any = await wait(agent, spend);
console.log("agent spend 1 USDC:", r2.status, r2.transactionHash ?? spend.userOpHash);
await show("after spend");

const rev = await cdp.evm.revokeSpendPermission({ address: treasury.address, permissionHash: sp.permissionHash, network: "base-sepolia" });
const r3: any = await wait(treasury, rev);
console.log("owner revoke:", r3.status, r3.transactionHash ?? rev.userOpHash);
console.log("onchain isRevoked:", await pc.readContract({ address: MGR, abi: ABI, functionName: "isRevoked", args: [perm] }), "| isValid:", await pc.readContract({ address: MGR, abi: ABI, functionName: "isValid", args: [perm] }));
try { const s2: any = await agent.useSpendPermission({ spendPermission: perm, value: 1_000_000n, network: "base-sepolia" }); const r4: any = await wait(agent, s2); console.log("POST-REVOKE SPEND RESULT (should fail):", r4.status); }
catch (e: any) { console.log("post-revoke spend rejected as expected:", String(e?.message ?? e).slice(0, 160)); }
await show("end");
