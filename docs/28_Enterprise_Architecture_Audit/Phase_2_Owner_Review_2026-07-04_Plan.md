# Owner Review 2026-07-04 — Analysis & Build Plan (to Google Play launch)

**Type:** Decision/plan doc (answers the owner's review + questions; sequences every request into phases)
**Standing goal:** finish all phases until Google Play launch · data safety is non-negotiable · simple enough for a non-accountant.

---

## 1. Answers to your questions (plain language)

### "Where are the other ledgers from the mockup?" (Automated Accounting)
Planned, partially built already — nothing was dropped. What the ecount screenshots list maps to us like this:

**Management Reports** (their list → our status)
| ecount report | Ours | Status |
|---|---|---|
| Cash Report | Cash Ledger tab + **Statement of Cash Flows** (M4D) | ✅ built |
| Monthly Income Statement | Income Statement (monthly rows) | ✅ built |
| Purchase Summary | Inventory purchase history (receivings list) | ✅ data exists → add a summary view (Phase B) |
| Monthly Cost | Monthly OpEx+COGS columns in the Income Statement | ✅ built (as columns) |
| Fund Statement / Fund In./De. details | Statement of Cash Flows (where money came from / went) | ✅ built (M4D) |
| Sales Summary | POS journal + Dashboard retail/wholesale split | ✅ built |

**Financial Statements** (your "what's this for?" items)
- **Balance Sheet** ✅ built — what the farm *owns vs owes* on one day.
- **Income Statement** ✅ built — did we *earn or lose* money over a period.
- **Compound Trial Balance** ✅ built — a self-check listing every account's debits & credits; the two totals must match, proving the books balance. You rarely read it; it proves nothing is broken.
- **Chart of Accounts** ✅ built — simply the *list of named money buckets* (Cash, Sales, COGS…). Not a report; a directory.
- **Retained Earnings Statement** ✅ built (Equity roll-forward in Management Reports) — how much profit stayed in the business instead of being drawn out.
- **Statement of Operation** — same thing as an Income Statement (non-profit wording). **Skip — duplicate.**
- **Schedule of Cost** — a production-cost build-up (seeds + labor + overhead per crop). Useful later with harvest batches (Phase 3 production ledger). **Deferred, on the list.**

**Other Ledgers**
- **Cash Book** ✅ covered — Cash Ledger tab (chronological cash in/out) + cash-flow statement.
- **Sales/Purchases Book** ✅ covered — POS Historical Journal (sales) + purchase receivings (purchases).
- **Customer/Vendor Book** — **Customer side ✅ built** (M9A Customers & Credit + per-customer Statement of Account). Vendor side waits until we owe suppliers money (today all purchases are cash → no payables). **Deferred deliberately (YAGNI).**
- **Ledger I / Ledger IV** — old manual-bookkeeping volume numbers (general ledger books). Our posted GL + trial balance IS this. **Covered.**
- **Currency Ledger** — multi-currency tracking. We operate in ₱ only. **Skip.**

### "Cash-advance ledger with live balance (**never stored**)" — what does that mean?
It means the balance number is **never saved as its own editable field anywhere**. Instead, every advance and every wage deduction is a permanent ledger line, and the balance is **recomputed from those lines every time you look at it** (like your bank app summing your transactions). Why: a stored balance can drift or be tampered with; a derived balance always matches the paper trail. This is the same rule for stock quantities and every account balance in the app — it's our core data-safety design.

### "When do we need Supabase integration and the local AI keys?"
- **Supabase: create the project NOW (during building), wire it BEFORE launch.** It's free-tier to start; the migrations are already written and CI-proven, so pointing the app at a real project is configuration (`.env`, never committed), not new code. It becomes *mandatory* at the hosting step (the PWA must live on HTTPS before the Play wrap). Doing it early also lets us test real-cloud mode + backups long before launch day.
- **Local AI (VeggieGenius / LM Studio): AFTER launch.** It's additive (AI assists, ERP authorizes — recorded stance), needs zero schema, and building it now would delay the launch path. The idea is recorded in the backlog doc so it won't be lost.

### "Expenses or Purchases? And where do Transportation/Electricity/Loan payments go?"
Recommended naming (simple + accountant-correct), already how the data flows underneath:
- **Purchases** = things that become *stock* (seeds, fertilizer, packaging, equipment) → auto-recorded in Inventory + books. ✅ already automatic.
- **Operating Expenses** = things you *consume as services* (transport, electricity, misc) → book to Operating Expenses, NOT inventory. ✅ already routed this way since M4A.
- **Loan Payment / Owner money** = not expenses at all — they're financing movements → Cash Entries. ✅ already separate.
So: rename the button "Add Material/Expense Purchase" → two clear entry points: **"Buy Stock (Purchases)"** and **"Log Expense (utilities, transport…)"** — same engine, clearer doors. (Phase A polish.)

### "Equipment purchases — inventory or what?"
Already solved the way you suggested: Inventory has **two types — Consumables and Equipment** (M3A `inventory_type`). Equipment purchases go into the Equipment tab with purchase cost on the books as an asset (not an expense), plus the **monthly condition checklist** you asked for (✅ built: working/needs-maintenance log per asset). The "Equipment Purchase" option under Cash Entries was deliberately excluded — equipment buying lives in Inventory so the asset is tracked.

### Wholesale pre-order: numpad optional + delivery
- **Skip-Weigh bulk lines already need no weighing** (flat negotiated price) — so a pre-order receipt can already be issued without the numpad. ✅ works today; will surface it better in the checkout UI (Phase A).
- **Delivery money editing:** when the delivery is paid, you settle it in the journal (Mark Paid). Recording *how much the vendor handed over + change given* on settle = a small money-path change (`pos_settle_sale` gains tender/change) → **Phase C (after the money review)**. Until then the journal records the settled amount itself, which keeps the books exact.

---

## 2. What you asked for that is ALREADY BUILT (verify on your screen)
- Purchase **source tracking** — Online (Lazada / Shopee / TikTok) vs Physical store + who/where. ✅
- **Pcs/qty purchased** reflected in inventory automatically. ✅
- **Low-stock warnings** (per-item reorder levels + dashboard Low-Stock tile + in-tab alerts). ✅
- **Equipment monthly checklist** (condition log: working / needs maintenance, inspector, notes). ✅
- Auto-sync everywhere: one entry → inventory + ledgers + statements (the GL posting engine). ✅ core design.
- **Active Slip Counter** — untouched, per your instruction. ✅
- **This session:** POS drawer strip removed (manual drawer at launch) ✅ · dark-mode toggle ✅ · Cosmic Mint replaced with calm **Midnight Farm** ✅ · **Green Pastures** made genuinely distinct ✅ · dark mode now recolours every surface ✅ · Inventory **"Log Stock Usage"** ("used 1 kg fertilizer for Tunnel 3" → stock down + cost booked) ✅.

## 3. Build plan — phases to launch

### Phase A — Launch UI/UX (no DB, starts immediately)
1. **Operations section**: merge *Schedules & Plans*, *Crops & Plans*, *Project Checklists* under one **Operations** entry with tabs/sub-tabs (Accounting-style). Nav shrinks to ~8 entries.
2. **Mobile-first pass**: bottom nav bar on phones with **4–5 slots, user-customizable** (per-device preference) + a **hamburger sheet** for everything else; responsive font/layout fixes on narrow screens; keep ≥48px touch targets.
3. **Plain-language pass**: hint/alt text on every money field ("What goes here?") so a non-accountant can read every number; naming split "Buy Stock" vs "Log Expense".
4. Surface Skip-Weigh better in pre-order checkout (numpad optional messaging).

### Phase B — Small governed DB slices (spec → migration → guard → UI, non-money)
5. **Payroll privacy**: link app users to employee records (`employees.user_id`); Operators/Admins/Employees see **only their own** pay data; Owner/Co-Owner/Dev see all. (RLS evolution + guard.)
6. **Schedule visibility tiers**: calendar events get a visibility level (e.g. General vs Management) + a **Settings panel** for who-sees/who-edits (your meeting-privacy rule), plus filters everywhere.
7. **Projects ↔ Calendar**: project timelines appear on the calendar; per-project view/edit setting; keep checklists.
8. **Roles & Approvals screen** (your screenshot): user directory with role dropdown (appointment hierarchy: Dev→all, Owner→Admin/Operator/Employee, Admin→Operator/Employee), per-feature access overrides (view-only / edit-manage), revoke — all as UI over our existing roles/permissions engine, company+branch system kept.
9. Purchase Summary report view; calendar Google-style day view with time indicator + drag-and-drop (view first, drag second).

### Phase C — Money-path (GATED on the cross-vendor money review; specs ready)
10. **B2 digital payments** (GCash/Maya/Bank as financial accounts — spec `6efaea4` committed).
11. Credit-limit enforcement in the sale; delivery settle with tender/change editing.

### Phase D — Cloud & Play launch
12. Supabase project + `.env` keys + real-mode testing + **backups/PITR enabled** (data-safety gate below).
13. **Sign-up + approval flow** (your design: register → pick role → "Please wait while we review your application" → Dev/Owner approves — wired to Roles & Approvals; registration queue table). Cloud-phase per your own note.
14. HTTPS hosting → PNG icons → Bubblewrap → signed AAB → assetlinks.json → Play Console (privacy policy, data safety, internal test track).

### Data safety at launch (the "my client will kill me" section)
Non-negotiables already in place: append-only ledgers (nothing money-related can be deleted, only reversed with a reason) · balances always derived, never stored · server is the source of truth; devices only cache · offline writes go through a crash-safe outbox with idempotency keys (a lost connection can't double-post or lose a sale) · every table tenant-isolated (RLS forced, CI-verified). Before launch we add: Supabase **daily backups + point-in-time recovery ON**, a restore drill (prove we can restore, not just back up), and the governed export. **No single-copy data anywhere.**

## 4. CI status on the push (audited by me, directly from GitHub)
Run `28689841036` @ `6efaea4`: **Verify (install/type/test/build) ✅ · DB guards (full battery) ✅ · Secret scan ❌ — FALSE POSITIVE** (Gitleaks' generic rule matched prose in the Play-readiness doc; no secret — the phrase "target-API-level compliance, closed/internal" looked like a key assignment). Reworded (`7de5077`) and re-pushed; the re-run's conclusion is reported in the session summary + handoff.
