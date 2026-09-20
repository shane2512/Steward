# DATA MODEL — Steward

Postgres 16 + Drizzle ORM (`packages/db`). All money columns are `numeric(78,0)` storing base units
(bigint in TS). All timestamps `timestamptz`. IDs are `uuid` (v7 preferred for ordering) unless noted.

## Entity overview

```
users 1─N wallets 1─N mandates 1─1 policies (one active)
wallets 1─N spend_permissions
wallets 1─N recipients            wallets 1─N vaults (allowlisted, per policy version snapshot)
wallets 1─N obligations
wallets 1─N agent_decisions 1─1 verdicts 0─1 executions
                              └─0─1 approvals
wallets 1─N notifications
audit_log (append-only, hash-chained, references any entity by (entity_type, entity_id))
receipt_nonces (unique)          price_snapshots / vault_snapshots (time series)
```

## Tables

### users
| col | type | notes |
|---|---|---|
| id | uuid pk | |
| owner_address | text unique | checksummed treasury (Coinbase Smart Wallet) |
| display_name | text null | |
| created_at | timestamptz | |
| last_login_at | timestamptz | |

### wallets
| col | type | notes |
|---|---|---|
| id | uuid pk | |
| user_id | uuid fk users | |
| chain_id | int | 84532 |
| treasury_address | text | = owner address at onboarding; sweep_home destination |
| agent_wallet_address | text unique | CDP smart account |
| agent_wallet_ref | jsonb | CDP identifiers needed to reload wallet (no secrets) |
| frozen | boolean default false | |
| frozen_at / frozen_reason | timestamptz / text | |
| breaker_failures | int default 0 | consecutive failures |
| breaker_open | boolean default false | |
| active_policy_version | int null | |
| created_at | timestamptz | |

### mandates
| id | wallet_id | text | template (`startup`,`dao`,`creator`,`custom`) | compiled_draft jsonb | assumptions jsonb | questions jsonb | prompt_version int | created_at |

### policies
| col | type | notes |
|---|---|---|
| wallet_id + version | composite pk | |
| mandate_id | uuid fk | |
| body | jsonb | full Policy (see POLICY_ENGINE.md) |
| body_hash | text | sha256 canonical |
| signature | text | owner EIP-191 over `Steward policy v{version} {body_hash}` |
| status | enum `draft|active|superseded` | exactly one active per wallet (partial unique index) |
| created_at / activated_at | timestamptz | |

### recipients
| id | wallet_id | label | address (checksummed) | max_per_tx | schedule jsonb | added_signature | status `active|removed` | created_at |
Unique `(wallet_id, address)`. Only created via owner-signed API.

### vaults
| id (slug, e.g. `v1`) + wallet_id pk | name | address | asset_address | kind `erc4626` | max_allocation_bps | flagged bool | flagged_reason | created_at |

### spend_permissions
| id | wallet_id | permission jsonb (account, spender, token, allowance, period, start, end, salt, extraData) | signature | permission_hash | status `pending|approved_onchain|revoked|expired` | approved_tx_hash | created_at | revoked_at |

### obligations
| id | wallet_id | recipient_id | amount | due_date date | recurrence `none|monthly` | status `scheduled|paid|failed|cancelled` | paid_execution_id | created_at |

### agent_decisions (one per loop iteration that reached reasoning or deterministic proposal)
| col | type | notes |
|---|---|---|
| id | uuid pk | |
| wallet_id | uuid | |
| trigger | text | `schedule|balance|obligation|risk|owner|approval` |
| context_snapshot | jsonb | the exact facts sent (no secrets) |
| context_hash | text | |
| screen | jsonb | heuristics + classifier result |
| proposal | jsonb null | validated Proposal or null (noop) |
| proposal_hash | text null | |
| proposal_source | text | `serv|deterministic|owner` |
| verifier | jsonb null | |
| serv_meta | jsonb | model, latency, tokens, prompt versions, request ids, native features |
| status | text | `noop|allowed|escalated|denied|reasoning_invalid|skipped` |
| created_at | timestamptz | |

### verdicts
| id | decision_id fk | decision `ALLOW|ESCALATE|DENY` | results jsonb (all rule results) | policy_version | evaluated_at |

### simulations
| id | decision_id | calls jsonb | calls_hash | ok | deltas jsonb | error text | block_number | created_at |

### approvals
| id | decision_id | wallet_id | proposal_hash | message | expires_at | status `pending|approved|rejected|expired|cancelled` | signature | decided_at |

### receipt_nonces
| nonce text pk | wallet_id | proposal_hash | issued_at | used_at |

### executions
| col | type | notes |
|---|---|---|
| id | uuid pk | |
| wallet_id, decision_id | uuid | |
| proposal_hash | text | unique `(wallet_id, proposal_hash)` |
| kind | text | |
| calls_hash | text | must equal simulation.calls_hash |
| user_op_hash / tx_hash | text | |
| status | `pending|submitted|confirmed|failed|timeout|cancelled` | |
| gas_used / error | text | |
| created_at / confirmed_at | timestamptz | |

### ledger_entries (derived accounting, for 24h outflow & export)
| id | wallet_id | execution_id | token | amount (signed) | direction `in|out` | counterparty_label | usd_micro | created_at |

### price_snapshots / vault_snapshots
`price_snapshots(token, micro_usd, published_at, source, created_at)`;
`vault_snapshots(wallet_id, vault_id, share_price, total_assets, position_assets, created_at)`.

### notifications
| id | user_id | wallet_id | type `execution|escalation|blocked|risk|freeze|report` | title | body | payload jsonb | read_at | channel `inapp|telegram` | created_at |

### audit_log (append-only)
| col | type | notes |
|---|---|---|
| id | bigserial pk | |
| wallet_id | uuid null | |
| actor | text | `agent|owner|system` |
| event | text | `CONTEXT|PROPOSAL|VERIFICATION|VERDICT|SIMULATION|RECEIPT|EXECUTION_*|APPROVAL_*|FREEZE|UNFREEZE|REVOKE|SWEEP|POLICY_ACTIVATED|RECIPIENT_*|BREAKER_*` |
| entity_type / entity_id | text | |
| payload | jsonb | canonical, no secrets |
| prev_hash / row_hash | text | hash chain per wallet (global chain for null wallet) |
| created_at | timestamptz | |
Trigger `audit_log_no_mutation` raises on UPDATE/DELETE. Writes go through `packages/db/src/audit.ts`
which serializes per-wallet with an advisory lock to compute `prev_hash`.

### jobs
Managed by pg-boss (its own schema `pgboss`).

## Key constraints & indexes
- Partial unique: `policies(wallet_id) where status='active'`.
- Unique: `executions(wallet_id, proposal_hash)`, `receipt_nonces(nonce)`, `recipients(wallet_id,address)`.
- Index: `ledger_entries(wallet_id, created_at)` for 24h window; `agent_decisions(wallet_id, created_at desc)`.
- Check constraints: amounts ≥ 0 where unsigned; `chain_id in (84532, 8453)`.
