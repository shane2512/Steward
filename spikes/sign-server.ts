// Local-only helper (127.0.0.1). Collects signatures for the V-05/V-10 spikes. Throwaway.
import http from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { config } from "dotenv";
import { build } from "esbuild";
import { encodeFunctionData } from "viem";
config({ path: "../.env.local", quiet: true });
const c: any = await import("./node_modules/@coinbase/cdp-sdk/_cjs/spend-permissions/constants.js");
await build({ entryPoints: ["sign/client.ts"], bundle: true, format: "esm", outfile: "sign/client.js", platform: "browser", target: "es2022" });
const params = { owner: process.env.TEST_OWNER_ADDRESS, spender: process.env.SPIKE_SPENDER, usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  manager: "0xf85210B21cC50302F477BA56686d2019dC9b67Ad", allowance: "5000000", nonce: Date.now().toString() };
const save = (f: string, o: unknown) => writeFileSync(f, JSON.stringify(o, null, 2));
http.createServer(async (req, res) => {
  const body = await new Promise<string>((r) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => r(b)); });
  const send = (t: string, ct = "application/json") => { res.setHeader("content-type", ct); res.end(t); };
  if (req.url === "/") return send(readFileSync("sign/index.html", "utf8"), "text/html");
  if (req.url === "/client.js") return send(readFileSync("sign/client.js", "utf8"), "text/javascript");
  if (req.url === "/params") return send(JSON.stringify(params));
  if (req.url === "/msg") { save(".msg.json", JSON.parse(body)); return send("{}"); }
  if (req.url === "/perm") { save(".perm.json", JSON.parse(body)); return send("{}"); }
  if (req.url === "/revoke") { save(".revoke.json", JSON.parse(body)); return send("{}"); }
  if (req.url === "/revoke-call") {
    const p = JSON.parse(readFileSync(".perm.json", "utf8")).permission;
    const arg = { ...p, allowance: BigInt(p.allowance), salt: BigInt(p.salt) };
    return send(JSON.stringify({ permission: p, data: encodeFunctionData({ abi: c.SPEND_PERMISSION_MANAGER_ABI, functionName: "revoke", args: [arg] }) }));
  }
  res.statusCode = 404; send("{}");
}).listen(4173, "127.0.0.1", () => console.log("open http://127.0.0.1:4173"));
