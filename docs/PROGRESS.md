# PROGRESS — Steward

> Claude updates this file at the end of every session. Human reviews it between phases.

## Current phase
Phase: 0 — in progress (0.1 done; blocked on human-provided credentials for spikes)
Required model: Sonnet
Last updated: 2026-09-20

## Phase status
| Phase | Title | Model | Status | Gate passed | Notes |
|---|---|---|---|---|---|
| 0 | Verification spike & repo bootstrap | Sonnet | ◐ | | |
| 1 | Monorepo foundation, DB, auth | Sonnet | ☐ | | |
| 2 | Wallet layer: AgentKit, spend permissions, contracts | Opus | ☐ | | |
| 3 | Policy Engine & mandate validator | Opus | ☐ | | |
| 4 | SERV reasoning & injection defenses | Opus | ☐ | | |
| 5 | Risk gate, executor, confirmer | Opus | ☐ | | |
| 6 | Decision loop, scheduler, obligations, risk exits | Opus | ☐ | | |
| 7 | Web app UX | Sonnet (+Opus sub-tasks) | ☐ | | |
| 8 | Owner controls, notifications, hardening, security review | Opus (+Sonnet sub-tasks) | ☐ | | |
| 9 | Demo, deployment, docs, submission | Sonnet (+Opus gate) | ☐ | | |

## Current phase plan
- [x] 0.1 git init, .gitignore, .nvmrc, README stub
- [ ] 0.2 spikes: serv-smoke, agentkit-smoke, spend-permission-smoke, usdc-and-price, verify-sig (need credentials)
- [ ] 0.2 docs research: V-09, V-11, V-12, V-14 (+ V-05 docs side)
- [ ] 0.3 record every result in Verification log
- [ ] 0.4 stop and ask human if any fallback weakens a security layer (esp. V-05)
- [ ] 0.5 docs/agentkit-actions.json, docs/addresses.md
- [ ] 0.6 propose spec diffs as Decisions

## Verification log (Phase 0)
| ID | Result | Evidence (link/file) | Date |
|---|---|---|---|

## Decisions (ADR-lite)
| # | Date | Decision | Why | Alternatives |
|---|---|---|---|---|

## Known issues / risks
- Local pnpm is 11.25 (spec says 9); Node 22.13.1, Docker 29.6.2, Foundry 1.5.1 present.
- Repo root contains duplicate copies of the spec .md files, `steward-claude-code-specs/` and the .zip; `docs/` is canonical. Zip and unpacked folder are git-ignored; root duplicates left untouched pending human OK to delete.
- No `.env.local` present yet; credentials needed for spikes.

## Next step
- Human provides Phase 0 prerequisites; then write and run spikes.
