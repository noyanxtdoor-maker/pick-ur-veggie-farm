# Phase 2 — CAP-VG1: VeggieGenius AI Copilot (Capability Spec — DESIGN ONLY, owner-timed)

**Type:** Capability specification (no code in this deliverable) · **Status:** Draft for owner + ARB review
· **Date:** 2026-07-06 · **Branch:** `feature/phase-0-foundation`
**Reviewer:** GLM 5.2 via Hermes CLI
**Authority invoked:** CLAUDE.md §6 (High-Risk Domain Tripwires — AI/automation) · C7 §11 (AI is advisory)
· `Phase_2_Mockup_Reference_and_Backlog.md §5` (recorded intent) · PIE v1.0 (frozen architecture per the
ChatGPT-derived project bootstrap) · charter §4.6 (no AI side channels around money/permissions).
**Precedent:** this mirrors the B2 digital-payments spec — design first, then `spec → review → build →
attack → owner-gate → lock` like every other module. **No code is written in this deliverable.**

---

## 0. Why a spec, not code, now

CLAUDE.md §2 requires authority before implementation. `Phase_2_Mockup_Reference_and_Backlog.md §5` records
VeggieGenius as "DECIDE LATER, do not build yet" — the owner has not yet given the timing GO. The ChatGPT
PIE v1.0 bootstrap ratifies the same boundary: architecture is frozen, ChatGPT is architecture guardian,
the implementer (Claude-equivalent — here, GLM/Hermes) builds capabilities only after ARB GO and one
capability at a time.

So the *correct* deliverable at this point is the **capability spec** that turns the recorded intent into an
approvable design. The next session can implement CAP-VG1 against this spec the moment the owner says go —
no architectural guessing, no security stance drift. Building the code now would violate §5's "do not build
yet" the same way building B2 now would expand the unreviewed money surface.

---

## 1. Capability identity

- **CAP-ID:** CAP-VG1 (VeggieGenius AI Copilot, read-only assist slice)
- **Surface:** a new `/copilot` nav entry in the V3 shell, behind a new `copilot.use` permission
  (26.09 tier: informational — granted to every role that can sign in; denied only if explicitly revoked).
- **Runtime:** **local** model served by **LM Studio** as an OpenAI-compatible API server
  (`http://localhost:1234/v1` by default, configurable in Settings). No per-call cloud cost; fully offline.
- **Failure mode:** if LM Studio is unreachable, the Copilot panel shows "Copilot offline — start LM
  Studio" and **every other ERP function works unchanged.** The ERP never depends on the AI being up.

---

## 2. What the Copilot does (scope — read-only assist first)

v1 = the four assistances the owner already named:

1. **Morning Brief** (CAP-001 in the PIE ledger): a daily digest — today's scheduled events, open
   invoices (AR), low-stock items, this-week payroll due, recent sales trend. One short, grounded answer.
2. **Q&A over ERP data** (natural-language reads): "Why did lettuce yield drop this month?",
   "Summarize this week's expenses", "Which customers have outstanding balances?"
3. **Recommendations** (advisory only): "What should I harvest this week given the schedule and
   inventory?", "Reorder suggestions for low-stock items." The Copilot returns *suggestions*; the user
   acts through the normal UI/flows.
4. **Function-calling** for structure: the Copilot may emit structured JSON the ERP consumes (e.g. a chart
   spec, a filtered view descriptor). The ERP renders it; it never auto-executes.

**Explicitly out of scope for v1:** AI-drafted writes. A future "AI drafts an action the human approves"
flow is a *separate capability* (CAP-VG2) and goes through the full spec → guard → owner-gate cadence.
v1 has zero write paths. C7 §11 honored by construction.

---

## 3. Architecture (additive, no new authority — reuses the M1B stack)

```
app/features/copilot/
  CopilotPanel.tsx        ← chat UI (history, input, citations)
  copilotApi.ts           ← thin client → /copilot/ask RPC (Supabase Edge Function OR a Vite dev proxy
                            in mock mode; reads-only)
  brief.ts                ← Morning Brief: gather ERP state → grounded context block
  grounding.ts            ← RAG retrieval: embed the question, search the local doc store + ERP reads
  types.ts                ← CAP-VG1 message, citation, and tool-call types
supabase/functions/copilot-ask/   ← (cloud phase) Edge Function: auth → permission check → call LM Studio
docs/28_Enterprise_Architecture_Audit/CAP_VG1_VeggieGenius_AI_Copilot_Spec.md   ← this file
```

**No DB migration in v1.** The Copilot produces no persisted ERP rows. Chat history lives in a
client-side IndexedDB store (`copilot_chats`, Dexie, like the existing mock caches) — separate key prefix
so the existing export already-excludes-outbox pattern is unaffected.

**Mock/offline parity:** in mock mode (no Supabase configured) the Copilot falls back to the same Dexie
caches every other module uses, so the demo path works without cloud. The real LM Studio call is the only
external dependency, and it degrades to an "offline" notice if absent.

---

## 4. Security & permissions (the non-negotiable spine — re-affirms §5 of the backlog)

- **The Copilot runs under the requesting user's permissions.** Every read it does is a read *that user
  could already do*. No elevation, no service_role token in the browser, no `bypass RLS`. C7 §11, B1.
- **No money paths.** CAP-VG1 issues zero writes to financial tables; it cannot call `pos_record_sale`,
  `pos_void_sale`, `record_cash_entry`, `payroll_disburse_wage`, etc. The Edge Function allow-lists only
  read RPCs (`trial_balance`, `income_statement_monthly`, `balance_sheet`, `balance_sheet`,
  `cash_flow_statement`, `employee_advance_balance`, `fg_available`, the read-only `*` select helpers).
- **No direct table access from the model.** The Edge Function performs the reads *as the user* (their
  JWT, RLS applies exactly as it would in the app) and feeds the model only the resulting rows. The model
  sees data the user is allowed to see — no more.
- **Grounding, not hallucination.** Every answer must cite the ERP rows/docs it used (citation block).
  An answer with no supporting rows says so explicitly ("no matching records in your access") rather than
  inventing.
- **Audit.** Each Copilot turn appends a `copilot.turn` row to `audit_events` (actor, prompt hash,
  grounded-source list, model id). No prompt or PII is logged beyond what audit law (C7 §7) already
  permits; the *answer* is not stored (client-only history).
- **No new service_role in the browser.** The cloud Edge Function holds any needed service role on the
  server only, and only for the read allow-list above — never exposed to the client.

---

## 5. Guard obligations (Tier-2, before this capability can lock)

These will be added to `scripts/guards/` when implementation is authorized:

- **perm-isolation:** a user without `copilot.use` cannot reach the panel; the Edge Function rejects them
  with `insufficient_privilege` (mirror every other read function).
- **rls-passthrough:** as a Worker with `schedule.read` only, the Copilot's grounding reads return only
  events the Worker can see — identical row count to a direct schedule-screen load. (Reuses the
  scheduling 15-battery pattern.)
- **money-immutability:** the Copilot Edge Function has no grant on any financial write function; a
  scripted attempt to invoke `pos_record_sale` etc. through it returns 403 / function-not-found. This is
  the technical enforcement of "no money paths."
- **no-bypass:** the Edge Function does NOT receive a service_role JWT for write operations ever; RLS
  policies apply identically to its reads.
- **offline-degrade:** with LM Studio down, the ERP's full functional surface still passes the existing
  164-guard suite unchanged (the Copilot is additive, not load-bearing).

---

## 6. Minimum-viable implementation slice (when owner authorizes)

Sequenced so each step is independently verifiable, mirroring how M2E/M4A/M5A evolved:

1. **Settings wiring:** add a "Copilot" card (LM Studio base URL + model id + toggle). Pure client state
   via the existing prefs mechanism (M8 pattern); no DB.
2. **CopilotPanel shell + client history:** the `/copilot` nav entry, empty-state ("Copilot offline"),
   chat input + IndexedDB history. Verifiable by browser E2E with no LM Studio running (offline notice).
3. **Grounding + Morning Brief (mock):** `brief.ts` gathers today's events + open invoices + low-stock
   from the existing Dexie caches and renders a *non-AI* brief. This proves the grounding path with zero
   model dependency.
4. **LM Studio call (local):** wire `copilotApi.ask` → LM Studio `/v1/chat/completions` with the grounded
   context. Verify with LM Studio running locally; verify degrade when stopped.
5. **Cloud Edge Function + RLS passthrough:** when Supabase is up (Phase D), add the Edge Function so the
   same panel works against the real DB under the user's JWT. Add the 5 guards of §5.

Step 1–4 are buildable *now* without Supabase, without money-path risk, and without crossing the §5
"decide later" line — they only need the owner to say "go ahead with CAP-VG1 v1."

---

## 7. Owner decision points (this spec is the input)

- **D1 — timing GO:** authorize CAP-VG1 implementation (steps 1–4 above are local-only; step 5 waits
  for the cloud phase).
- **D2 — model choice:** which LM Studio model(s) — reasoning vs. writing vs. coding profile. The spec
  is model-agnostic; the answer is a Settings preference.
- **D3 — RAG corpus:** which docs go in the grounding store — architecture docs (28_Enterprise),
  SOPs, the schedule/inventory/crop masters? Owner decides what the Copilot is *allowed to know*.
- **D4 — audit retention:** the C7 §7 default applies; if the owner wants a different retention for
  `copilot.turn` events, state it now.

---

## 8. What this spec does NOT do (so the next session can't drift)

- No code. No migration. No Edge Function. No LM Studio install. **Nothing is built by this deliverable.**
- Does not modify Systems 10–26, B1–B8, C1–C8, or the frozen PIE v1.0 architecture. If any conflict
  emerges during implementation, the higher authority wins and this spec is corrected (CLAUDE.md §0).
- Does not touch the money path, the auth/RLS resolver, or any existing permission key. `copilot.use`
  is *additive* and informational.
- Does not promise cloud AI. The whole value of the design is "AI assists locally; the ERP keeps working
  when it's off." A later cloud-AI fallback is a separate capability and a separate owner decision.

---

## 9. Reviewer summary

The design preserves every C7 §11 / B1 / charter §4.6 invariant: AI is advisory, runs under the user's
permissions, no money paths, no RLS bypass, offline-degradable, additive. v1 has zero write surface by
construction. The implementation sequence is non-money and local-only through step 4, so the owner can
greenlight CAP-VG1 without first resolving the Phase C money-path gates — the two tracks are independent.

**Verdict (design): GO for spec — implementation owner-timed, gated on D1 above.**
