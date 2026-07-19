-- Migration P2S1 — company-level tax rate (owner backlog item, 2026-07-19: "Move tax, currency, and
-- backup settings from device-only storage to the server so they're shared across devices").
--
-- Narrower in practice than it sounds once audited: `companies.base_currency_code` is ALREADY
-- server-stored and shared across every device (M2, immutable by design — see that migration's own
-- comment: an accounting tenant's currency cannot change after postings exist). Backup/export is a
-- client-triggered action against already-server-stored data (`app/features/settings/export.ts`), not
-- a persisted preference that could drift between devices — nothing to move there either. TAX RATE is
-- the one genuinely missing piece: it doesn't exist ANYWHERE in this app today, device-side or
-- server-side (grepped `app/` for "tax_rate"/"vat" — zero hits outside a vendor's unrelated Tax ID/TIN
-- field). A tax rate is exactly the kind of value that MUST be identical across every cashier's POS
-- terminal, so it's added directly as a server-synced company column rather than as a client pref.
--
-- Follows the exact `companies.name` pattern already established (M1C §8.3, company.tsx): a plain
-- column-scoped UPDATE grant + the existing `companies_update_manage` RLS policy — no new RPC needed,
-- since this is a single unconstrained-by-audit-trail company attribute, not a governed money-path
-- action. Writes go through the same generic offline-queued `update` request every other company-field
-- edit already uses (see `app/features/organization/company/company.tsx`).
alter table public.companies add column tax_rate numeric(5, 2) not null default 0
  check (tax_rate >= 0 and tax_rate <= 100);
comment on column public.companies.tax_rate is 'P2S1: company-wide sales/VAT tax rate (%), server-synced across every device. company.manage-editable, same grant shape as companies.name.';

grant update (tax_rate) on public.companies to authenticated;
