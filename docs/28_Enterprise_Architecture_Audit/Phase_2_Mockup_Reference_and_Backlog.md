# Phase 2 — Refined Mockup Reference & Reconciled Backlog (analysis; no code)

**Type:** Reference analysis + backlog (not a spec, not architecture) · **Date:** 2026-07-03 ·
**Branch:** `feature/phase-0-foundation`
**Owner decisions (2026-07-03):** (1) *analysis doc only* — do NOT commit the screenshots into git; they stay at the
external path below. (2) *Backlog the deferred features, keep current priority order* (Payroll → Scheduling →
Settings next). (3) *VeggieGenius AI Copilot* = record the intent, **decide timing later**.

## 0. What this is (and what it is NOT)

The owner provided a **refined Google AI Studio mockup** ("95% accurate to the app I want — its system and its
workflow") as 35 screenshots. This mockup is **newer and more complete** than the `src/` prototype the earlier
Phase-2 work was built from. This doc catalogues it and reconciles the extra features into a backlog.

**This doc changes nothing about our architecture or security.** Systems 10–26, the ADR/ODR decisions, C7
(Engineering Constitution), CLAUDE.md, and the AI Company Charter remain the sole authority. The refined mockup is
a **workflow + visual reference** only (same standing as `src/`, per the 2026-06-28 owner decision that the AI
Studio prototype is the workflow-logic + visual authority). Where the mockup implies a data/GL/security change,
that goes through the normal spec → guard → attack → owner-gate cadence — it is never adopted silently.

> **Note on the ChatGPT "PIE / PEGASUS" documents** (the two `.txt` files, from the owner's ChatGPT session about
> local-AI hosting): these are treated as **input about the future AI feature's intent only** (see §5). Their
> parallel governance vocabulary (PIE, PEGASUS, ARB, ACR, NEXT_CHAT_BOOTSTRAP) does **not** replace our governance.
> Ours stays authoritative. The one thing that carries over cleanly is a *security principle we already enforce*:
> **AI assists, ERP authorizes, humans approve; no AI bypasses security, finance, or permissions.**

## 1. Source location (intentionally NOT in git)

`C:\Users\sherl\Documents\UI and System Workflow Reference\` — 35 PNGs dated 2026-07-03 (~8 MB total). Kept
out of the repo by owner decision. When building a given module, read that module's screenshot(s) there for
pixel/workflow fidelity, alongside the corresponding `src/features/*.tsx` for the logic. **This analysis sampled
5 of 35 screens** (Accounting ×2, POS ×2, Project Checklists ×1); the rest are per-module detail for build time.

## 2. The intended app — full module set (from the sidebar) vs current build status

| Sidebar item | Canonical home | Build status |
|---|---|---|
| Home Dashboard | 22.22 exec dashboard | ✅ built (M2D) — real KPIs + Low-Stock tile |
| Weigh Point-Of-Sale | 20.17 / 22.06 | ✅ built (M2A–M2E) — **but mockup adds customer master + digital payments → §4** |
| Stock Inventories | 20.07–20.12 / 20.25 | ✅ built (M3A–M3B) |
| Accounting Ledgers | 22.x | ✅ core built (M4A–M4B) — **but mockup adds full statements + mgmt reports + ledgers → §4** |
| Schedules & Plans | 20.19 calendar engine | ⬜ not built |
| Project Checklists | operational (Monday.com-style) | ⬜ not built |
| Salaries & Payroll | System 21 | ⬜ not built — **NEXT per roadmap** |
| VeggieGenius AI Copilot | new AI layer (PIE/LM Studio) | ⬜ not built — **decide later, §5** |
| Settings Hub | Settings / backup / theme | ⬜ not built |
| Approvals & Roles | M1–M6 + P2-M1 (org) | ✅ built (frozen admin module) |

Chrome seen across screens: a **backup reminder** ("Backup Due (Over 24h)"), **"Session: dev / Developer Access"**
role badge, **"Offline Local Mode — stored on local browser index unless backup triggered."** (The black top bar
with *Remix / Device* is Google AI Studio's own chrome, not part of the app.)

## 3. Where the mockup CONFIRMS the current build (good — no action)

- **Accounting cash-movements** ("Cash Report" → Owner Investment / Loan Received / Equipment Purchase / Owner's
  Drawings, Debit-In / Credit-Out) matches M4A `cash_entries` exactly. ✅
- Farm-priced weigh sale, pre-order, bulk/wholesale, farm theme, offline-local mode — all as built. ✅

## 4. Reconciled backlog (features the mockup shows beyond current specs)

**All of these were already flagged "deferred, not forgotten" in the M3/M4 specs. Priority order is unchanged
(Payroll → Scheduling → Settings first). Each maps cleanly to a canonical System — none require an architecture or
security change; all are additive migrations on the existing spine.**

| # | Mockup feature | Canonical mapping | Current state | Notes |
|---|---|---|---|---|
| B1 | **POS Customer Master + Credit Standing** (Good Standing / Delayed Balance = pre-orders limited / Restricted = cash-only) | 20.11 `business_partners` + 22.07 AR credit controls | `sales_orders.customer_id` is nullable (walk-in); partners master deferred (Inventory spec §2) | Credit standing gates pre-order eligibility — an authorization rule; must go through RLS/permission review, not client-only. |
| B2 | **Multi-channel digital payments** (Direct Cash / Digital Pay = GCash · Maya · Local Savings Bank · Credit-Debit + **reference no.** / Wholesale Link / Pre-Order) | 22.10 wallets/bank + 20.24 `financial_accounts` | Cash tender only (`invoices.tender_cash`); pre-order built (M2C) | **Security/finance boundary (22.02): the ERP RECORDS a payment against a financial account + reference number; it does NOT move money.** GL posting swaps Dr Cash → Dr GCash/Bank/Wallet per tender. |
| B3 | **Full accounting statements** — Statement of Cash Flows · Schedule of Cost of Production · Statement of Operations · Retained Earnings (standalone) | 22.22 | Deferred (M4 spec §2); RE value already on the balance sheet | All are **reads over the posted GL** (same pattern as M4B) — no new write path. |
| B4 | **Management Reports** — Cash Report · Purchase Summary · Sales Summary · Monthly Cost Breakdowns | 22.22 / 22.23 | Deferred (M4 spec §2) | Reporting reads only. **Reconciliation caveat:** the "Cash Report" must aggregate *all* cash movements (cash_entries + the cash side of purchases/sales) as a **read view** — it must NOT reintroduce a second write path for equipment purchases (those already post via `inventory_record_purchase`, M4A §3 finding). |
| B5 | **Ledgers & Books** — GL drill-down · Cash Book · Vendor/Customer ledger | 22.04 / 22.08 | Deferred | Vendor/Customer ledger depends on B1 (20.11 partners). |
| B6 | **Expense-category P&L breakdown** (COGS by Seeds/Nutrients/Packaging; OpEx by Labor/Diesel) | 22.05 / 22.17 | M4B income statement reads GL *accounts* (SALES/COGS/OPERATING_EXPENSES) | When B1/partners + finer expense accounts land, the P&L can break COGS/OpEx down by category. Additive to `income_statement_monthly`. |
| B7 | **Backup / export system** ("Backup Due (Over 24h)") | B5 offline + Settings | Not built | A local export/backup mechanism; belongs with Settings Hub. |
| B8 | **Schedules & Plans** (calendar) | 20.19 calendar event engine | Not built | Post-Payroll. |
| B9 | **Project Checklists** ("Farm Projects Board", Monday.com-style: projects → step checklists, %complete, managers, target dates, "done by") | operational feature (no single enterprise System owns it) | Not built | Reuses branch/permission/audit spine; no financial impact. |

## 5. VeggieGenius AI Copilot — recorded intent (DECIDE LATER, do not build yet)

Captured so it is not lost; **owner will decide timing.** This is the "PIE" (PickUrVeggie Intelligence Engine) from
the ChatGPT session, surfaced in the app as the **VeggieGenius AI Copilot** nav item.

- **Runtime:** a **local** model via **LM Studio** as an OpenAI-compatible API server (`http://localhost:1234/v1`).
  Fully offline-capable; no per-call cloud cost. Model choice per task (coding / reasoning / writing).
- **Pattern:** **ERP owns authority; the AI owns intelligence.** The Copilot *assists* — summaries, Q&A over ERP
  data, recommendations, "why did lettuce yield drop", "summarize this week's expenses". It **authorizes nothing**.
- **RAG:** retrieval over ERP + farm docs (architecture docs, SOPs, schedules) so answers are grounded, not
  hallucinated. **Function-calling** can return structured JSON the ERP consumes.
- **Security stance (unchanged from our plan, non-negotiable):** the Copilot runs **under the requesting user's
  permissions** — it never elevates, never bypasses RLS, never posts finance directly, never sees data the user
  can't. **Read-only assist first.** Any future "AI-drafted action" is a *draft a human approves*, executed through
  the same governed functions with the same permission checks — never a privileged side channel. When built it goes
  through the full spec → guard → attack → owner-gate cadence like every other module.

## 6. Not touched by this doc

- **Architecture** (Systems 10–26) — unchanged.
- **Security / RLS / permissions** — unchanged. (B1/B2/B6 will be reviewed under RLS when specced.)
- **Priority order** — unchanged: **Payroll (System 21) is next.**
- **Screenshots** — not committed (owner decision); referenced at the external path.
- **Stitch design MCP** — pending owner go: I can run `claude mcp add stitch …` to configure it for the next
  session (it is not usable this session — MCP servers load at startup). ⚠️ The pasted Google API key is now in
  plaintext in the chat log; rotate it if that log could be exposed.
