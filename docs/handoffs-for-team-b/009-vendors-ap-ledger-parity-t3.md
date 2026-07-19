# Handoff 009 — Reverse-parity port FROM Repo B: Vendors + Cost Schedule + AP Ledger (T3.1/T3.2), 2026-07-19

**Direction note:** like 003/004/005/008, this is Team A porting FROM Team B — your vendor master, cost
schedule (per-vendor×product rate card), and full AP ledger (`vendor_invoice_record` →
`vendor_payment_record` → `vendor_ap_standing`) ported clean, no schema conflicts. **This reverses an
earlier Repo A YAGNI deferral** ("supplier/AP master — cash-only purchases") — worth knowing if you ever
see an old note in our direction claiming this was intentionally skipped; the owner reversed that call.

## What ported clean vs. what needed adaptation

The migrations (`vendors`, `vendor_invoices`, `vendor_payments`, `cost_schedule`, the four RPCs) ported
near-verbatim — verified against Repo A's `inventory_record_purchase`
(`20260703090000_p2m4a_accounting_core.sql:47-134`), which turned out to be byte-identical to what your
T3.2 assumes it's evolving from (same argument shape, same category→GL mapping), so T3.2's
append-a-12th-arg approach applied without modification.

The **app layer** (`VendorsScreen.tsx`) needed three adaptations, not a straight copy — worth checking
if your own screen has the same shape:

1. **Company ID source.** Your version used a raw query helper to resolve `company_id`; ours reads it
   from `usePermissions()`, the pattern every other screen in this repo already uses. Not a functional
   bug, just a consistency fix for our codebase.
2. **Branch picker, not "first active branch."** Your Invoice/Payment dialogs silently used the user's
   first active branch. For a genuinely multi-branch company this is wrong — the invoice/payment should
   be attributable to whichever branch it's actually for. We added an explicit branch `SelectField`,
   matching the pattern Payroll/Customers/Accounting already use in this repo. If your product is
   single-branch-per-tenant this may not matter to you, but if you ever go multi-branch, this is a real
   gap worth checking.
3. **Offline queue.** Your writes call the RPCs directly with no offline fallback. Every other write in
   this repo goes through an `online() ? rpc(...) : enqueue(...)` pattern (see `app/core/offline/queue.ts`)
   so a write made while offline queues and replays on reconnect instead of failing outright. We wired
   `vendorsApi.ts` the same way.

## A real bug caught during E2E, not by inspection

A **fresh company with an empty chart of accounts** made the very first vendor invoice fail outright —
`vendor_invoice_record`/`vendor_payment_record` assumed the `AP`/`CASH` accounts already existed (true
for any company that had already run a sale or a Buy Stock purchase, which seeds them, but not true for
a brand-new company whose first-ever money-path action is a vendor invoice). Fixed by having both RPCs
self-seed via `vendor_ensure_accounts`/`inventory_ensure_accounts` before posting, the same idempotent
"ensure the accounts exist" pattern the rest of the accounting core already uses. If your own onboarding
path lets a company's first transaction be something other than a sale, check whether you have the same
gap.

## Vendor picker in Buy Stock (T3.2)

Confirmed fully compatible — see above. `InventoryScreen.tsx`'s Buy Stock modal gained a "Registered
Vendor" source option that auto-fills source name/contact from the vendor master when picked.

## Files (Repo A paths — your port is its own migration/commit, not a reference to these)

| Item | File |
|---|---|
| T3.1 migration (vendors/cost-schedule/AP ledger) | `supabase/migrations/20260718070000_t3_1_vendors_and_ledger.sql` |
| T3.2 migration (vendor picker in Buy Stock) | `supabase/migrations/20260718080000_t3_2_purchase_vendor_link.sql` |
| Guards | `scripts/guards/t3-1-vendors-and-ledger-security.sql`, `scripts/guards/t3-2-purchase-vendor-link-security.sql` |
| App — Vendors & AP screen | `app/features/vendors/VendorsScreen.tsx`, `app/features/vendors/api.ts` |
| App — Buy Stock vendor picker | `app/features/inventory/InventoryScreen.tsx` |
| Owner follow-up (2026-07-19): manual per-invoice payment allocation UI (RPC already supported it, only the UI auto-FIFO'd) | `app/features/vendors/VendorsScreen.tsx` (`PaymentDialog`) |
