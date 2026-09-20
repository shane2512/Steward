# API — Steward

All web routes are Next.js route handlers under `apps/web/app/api`. JSON in/out, zod-validated.
Auth: iron-session cookie from SIWE. **Sensitive** routes also require a fresh owner signature in
the body (`signature` over a server-issued message with nonce, TTL 5 min).

Error shape: `{ error: { code: string, message: string } }`. Money fields are decimal strings of base units.

## Auth
| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/api/auth/nonce` | — | returns SIWE nonce |
| POST | `/api/auth/verify` | `{ message, signature }` | verifies SIWE (ERC-1271/6492 aware), sets session; creates user on first login |
| POST | `/api/auth/logout` | — | |
| GET | `/api/me` | — | user + wallet summary |

## Onboarding & wallet
| Method | Path | Notes |
|---|---|---|
| POST | `/api/wallet/provision` | creates agent wallet via AgentKit if none (idempotent) |
| GET | `/api/wallet` | balances, allowance remaining, positions, max-at-risk, frozen state |
| POST | `/api/spend-permission/prepare` | `{ allowance, periodSeconds, start, end }` → typed data to sign |
| POST | `/api/spend-permission` | `{ permission, signature }` stores; worker approves on-chain on first use |
| GET | `/api/spend-permission` | status |

## Mandate & policy
| Method | Path | Notes |
|---|---|---|
| POST | `/api/mandate/compile` | `{ text, template }` → `{ draft, sentences, issues, assumptions, questions }` (calls SERV compiler, then validator) |
| POST | `/api/policy/prepare` | `{ draft }` → message to sign (`Steward policy v{n} {hash}`) |
| POST | `/api/policy/activate` | **sensitive** `{ draft, signature }` → new active version |
| GET | `/api/policy` | active policy + sentences |

## Recipients, vaults, obligations
| Method | Path | Notes |
|---|---|---|
| POST | `/api/recipients` | **sensitive** add; triggers new policy version draft |
| DELETE | `/api/recipients/:id` | **sensitive** |
| GET | `/api/recipients` | |
| GET | `/api/vaults` | allowlisted vaults (MVP: configured by env/seed, owner toggles include) |
| POST | `/api/obligations` | `{ recipientId, amount, dueDate, recurrence }` (owner session) |
| GET | `/api/obligations` | |

## Agent activity
| Method | Path | Notes |
|---|---|---|
| GET | `/api/decisions?cursor=` | timeline (decision + verdict + execution joined) |
| GET | `/api/decisions/:id` | full detail incl. rule results |
| POST | `/api/agent/run` | owner-triggered iteration now (enqueues job) |
| GET | `/api/approvals?status=pending` | |
| POST | `/api/approvals/:id/approve` | **sensitive** `{ signature }` over approval message (SECURITY §5) |
| POST | `/api/approvals/:id/reject` | |

## Owner control (no reasoning imports — I7)
| Method | Path | Notes |
|---|---|---|
| POST | `/api/freeze` | **sensitive**; sets frozen, cancels approvals/jobs, returns revoke tx data |
| POST | `/api/unfreeze` | **sensitive**; resets breaker |
| POST | `/api/sweep` | **sensitive**; enqueues owner-sourced `sweep_home` (allowed while frozen) |
| POST | `/api/spend-permission/revoked` | `{ txHash }` owner reports revoke; worker verifies on-chain |

## Audit & export
| Method | Path | Notes |
|---|---|---|
| GET | `/api/audit?cursor=` | |
| GET | `/api/audit/verify` | recomputes hash chain → `{ ok, brokenAt? }` |
| GET | `/api/export?format=csv|json` | ledger + decisions |

## Notifications
| GET | `/api/notifications` | · | POST `/api/notifications/:id/read` |

## Demo-only (DEMO_MODE && chain 84532; 404 otherwise)
| POST | `/api/demo/inject-memo` | send a USDC dust transfer with malicious memo / or insert untrusted fact |
| POST | `/api/demo/vault-drawdown` | calls MockVault to reduce share price |
| POST | `/api/demo/tick` | advance demo yield / trigger loop |

## Internal (worker) interfaces
```ts
DecisionLoop.run(walletId, trigger): Promise<DecisionOutcome>
ContextBuilder.build(walletId): Promise<Context>
Reasoning.{compileMandate, propose, verify, screenUntrusted, explain}
Policy.{evaluate, validatePolicyDraft, signReceipt, verifyReceipt, hashProposal}
Risk.{simulate(calls, from), getPrices(tokens), detectRiskTriggers(walletId)}
Wallet.{provision, execute(proposal, receipt), sweepHome(walletId), readAllowance(walletId)}
Confirmer.watch(executionId)
Notifier.send(userId, notification)
```
Jobs (pg-boss): `loop.tick` (cron */5 min per active wallet; 30s in DEMO_MODE), `loop.run`,
`exec.confirm`, `obligations.scan` (hourly), `risk.scan` (every minute), `approvals.expire` (5 min).
