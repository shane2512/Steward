import { createCoinbaseWalletSDK } from "@coinbase/wallet-sdk";
const $ = (id: string) => document.getElementById(id)!;
const log = (m: string) => { $("log").textContent += m + "\n"; };
const found: { info: { name: string; rdns: string }; provider: any }[] = [];
window.addEventListener("eip6963:announceProvider", (e: any) => found.push(e.detail));
window.dispatchEvent(new Event("eip6963:requestProvider"));
await new Promise((r) => setTimeout(r, 800));
const w = window as any;
log("EIP-6963 wallets found: " + (found.map((f) => f.info.name + " [" + f.info.rdns + "]").join(", ") || "none") + " | window.ethereum: " + (w.ethereum ? "present" : "absent") + " | window.coinbaseWalletExtension: " + (w.coinbaseWalletExtension ? "present" : "absent"));
const cb = found.find((f) => /coinbase/i.test(f.info.rdns + f.info.name) && !/smart|keys/i.test(f.info.name))?.provider ?? w.coinbaseWalletExtension ?? found[0]?.provider ?? w.ethereum;
const provider = cb ?? createCoinbaseWalletSDK({ appName: "Steward spike", preference: { options: "smartWalletOnly" } }).getProvider();
log("using: " + (cb ? "injected extension" : "Smart Wallet popup (no extension detected)"));
let account = "";
const params = await (await fetch("/params")).json();
const post = (path: string, body: unknown) => fetch(path, { method: "POST", body: JSON.stringify(body) });
const hexChain = "0x14a34"; // 84532

$("connect").onclick = async () => {
  await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexChain }] }).catch(() => {});
  const accts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  account = accts[0]!; log("connected: " + account + (account.toLowerCase() === params.owner.toLowerCase() ? " (matches TEST_OWNER_ADDRESS)" : " (DIFFERENT from TEST_OWNER_ADDRESS!)"));
};
$("msg").onclick = async () => {
  const message = "Steward V-10 test " + params.nonce;
  const sig = await provider.request({ method: "personal_sign", params: [message, account] });
  await post("/msg", { account, message, sig }); log("message signed, sent to local script");
};
$("perm").onclick = async () => {
  const permission = { account, spender: params.spender, token: params.usdc, allowance: params.allowance, period: 86400, start: Math.floor(Date.now() / 1000) - 60, end: Math.floor(Date.now() / 1000) + 3600, salt: String(BigInt(Math.floor(Math.random() * 2 ** 52))), extraData: "0x" };
  const typedData = { domain: { name: "Spend Permission Manager", version: "1", chainId: 84532, verifyingContract: params.manager },
    types: { SpendPermission: [
      { name: "account", type: "address" }, { name: "spender", type: "address" }, { name: "token", type: "address" },
      { name: "allowance", type: "uint160" }, { name: "period", type: "uint48" }, { name: "start", type: "uint48" },
      { name: "end", type: "uint48" }, { name: "salt", type: "uint256" }, { name: "extraData", type: "bytes" }] },
    primaryType: "SpendPermission", message: permission };
  const sig = await provider.request({ method: "eth_signTypedData_v4", params: [account, JSON.stringify(typedData)] });
  await post("/perm", { permission, sig }); log("permission signed (5 USDC/day cap, 1h validity), sent to local script");
};
$("revoke").onclick = async () => {
  const { permission, data } = await (await fetch("/revoke-call")).json();
  log("requesting revoke() from owner wallet for permission salt " + permission.salt);
  const id = await provider.request({ method: "wallet_sendCalls", params: [{ version: "1.0", chainId: hexChain, from: account, calls: [{ to: params.manager, data, value: "0x0" }] }] });
  await post("/revoke", { id }); log("revoke submitted: " + JSON.stringify(id));
};
