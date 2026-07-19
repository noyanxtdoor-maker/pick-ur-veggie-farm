// Vendors & AP (T3.1, 2026-07-19) — vendor master + cost-schedule + AP ledger.
// Ported from Repo B (GLM Version) and adapted: companyId from usePermissions() (not a raw query),
// an explicit branch SelectField in each money-posting dialog (not a silent "first active branch"
// lookup), and writes wired through the offline-queue-aware vendorsApi (see api.ts).
// Mirrors the Customers & Credit surface in structure (data table on top, edit/create + record actions).
// All writes go through the proven SECURITY DEFINER RPCs (vendor_upsert, cost_schedule_upsert,
// vendor_invoice_record, vendor_payment_record). Reads come from vendor_ap_standing (derived).
import {useCallback, useEffect, useState} from 'react';
import {useLiveQuery} from 'dexie-react-hooks';
import * as Dialog from '@radix-ui/react-dialog';
import {FileText, Pencil, Plus, Truck, Wallet, X} from 'lucide-react';
import {offlineDB} from '../../core/offline/db';
import {hydrateBranches} from '../../core/offline/hydrate';
import {supabase} from '../../core/supabase/client';
import {usePermissions} from '../../core/permissions/permissions';
import {Button, Card, PageHeader} from '../../components/ui';
import {EmptyState, Skeleton, useToast} from '../../components/feedback';
import {SelectField} from '../../components/overlay';
import {formatPeso} from '../pos/money';
import {vendorsApi, type Vendor, type VendorAPStanding} from './api';
import type {Branch} from '../../types/db';

export default function VendorsScreen() {
  const {companyId, has} = usePermissions();
  const {notify} = useToast();
  const canRead = has('vendor.read');
  const canManage = has('vendor.manage');

  const branches = useLiveQuery(async () => (companyId ? offlineDB.branches.where('company_id').equals(companyId).filter((b) => b.status === 'Active').toArray() : []), [companyId]);
  useEffect(() => {if (companyId) hydrateBranches(companyId);}, [companyId]);

  const [vendors, setVendors] = useState<Vendor[] | null>(null);
  const [standing, setStanding] = useState<VendorAPStanding[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Vendor | null>(null);
  const [invoiceFor, setInvoiceFor] = useState<Vendor | null>(null);
  const [paymentFor, setPaymentFor] = useState<VendorAPStanding | null>(null);

  const reload = useCallback(() => {
    if (!companyId || !canRead) return;
    vendorsApi.list(companyId).then(setVendors).catch(() => setVendors([]));
    vendorsApi.standing(companyId).then(setStanding).catch(() => setStanding([]));
  }, [companyId, canRead]);
  useEffect(reload, [reload]);

  const wrap = (fn: () => Promise<void>, ok?: string) => async () => {
    setBusy(true);
    try { await fn(); if (ok) notify(ok); reload(); }
    catch (e) { notify(e instanceof Error ? e.message : 'Failed', 'error'); }
    finally { setBusy(false); }
  };

  const apById = new Map((standing ?? []).map((s) => [s.vendor_id, s]));

  if (!canRead) {
    return (
      <div>
        <PageHeader title="Vendors &amp; AP" />
        <Card><EmptyState title="Vendor access needed" hint="Your role does not include the vendor.read permission." /></Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Vendors & AP"
        subtitle="Vendor master, cost-schedule rate card, and outstanding accounts-payable balances."
        action={canManage ? (
          <Button onClick={() => setEditing({id: '', company_id: companyId!, vendor_code: '', name: '', contact: null, address: null, tax_id: null, payment_terms: null, notes: null, status: 'Active', created_at: ''} as Vendor)}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden /> New Vendor
          </Button>
        ) : null}
      />

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-bold text-farm-green">Vendor Master</h3>
          {vendors === null ? <Skeleton rows={1} /> : <span className="text-xs text-farm-muted">{vendors.length} vendor{vendors.length === 1 ? '' : 's'}</span>}
        </div>
        {vendors === null ? (
          <Skeleton rows={3} />
        ) : vendors.length === 0 ? (
          <EmptyState title="No vendors yet" hint={canManage ? 'Add one with "New Vendor" to start recording bills.' : 'None recorded.'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-farm-accent-soft text-left text-xs uppercase text-farm-muted">
                  <th className="px-2 py-2">Code</th>
                  <th className="px-2 py-2">Name</th>
                  <th className="px-2 py-2">Contact</th>
                  <th className="px-2 py-2">Terms</th>
                  <th className="px-2 py-2 text-right">Invoiced</th>
                  <th className="px-2 py-2 text-right">Paid</th>
                  <th className="px-2 py-2 text-right">Outstanding AP</th>
                  <th className="px-2 py-2">Status</th>
                  {canManage ? <th className="px-2 py-2"></th> : null}
                </tr>
              </thead>
              <tbody>
                {vendors.map((v) => {
                  const s = apById.get(v.id);
                  return (
                    <tr key={v.id} className="border-b border-farm-accent-soft/50 last:border-0">
                      <td className="px-2 py-2 font-mono text-xs">{v.vendor_code}</td>
                      <td className="px-2 py-2 font-semibold text-farm-ink">{v.name}</td>
                      <td className="px-2 py-2 text-xs text-farm-muted">{v.contact ?? '—'}</td>
                      <td className="px-2 py-2 text-xs">{v.payment_terms ?? '—'}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{s ? formatPeso(s.total_invoiced) : '—'}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{s ? formatPeso(s.total_paid) : '—'}</td>
                      <td className="px-2 py-2 text-right tabular-nums font-bold text-farm-danger">{s ? formatPeso(s.outstanding_ap) : '—'}</td>
                      <td className="px-2 py-2 text-xs">{v.status}</td>
                      {canManage ? (
                        <td className="px-2 py-2 text-right">
                          <span className="inline-flex gap-1">
                            <button onClick={() => setEditing(v)} title="Edit vendor" className="rounded p-1 text-farm-muted hover:bg-farm-bg hover:text-farm-green" aria-label="Edit vendor"><Pencil className="h-4 w-4" aria-hidden /></button>
                            <button onClick={() => setInvoiceFor(v)} title="Record vendor invoice" className="rounded p-1 text-farm-muted hover:bg-farm-bg hover:text-farm-green" aria-label="Record vendor invoice"><FileText className="h-4 w-4" aria-hidden /></button>
                            {s && s.outstanding_ap > 0 ? (
                              <button onClick={() => setPaymentFor(s)} title="Record payment" className="rounded p-1 text-farm-muted hover:bg-farm-bg hover:text-farm-green" aria-label="Record payment"><Wallet className="h-4 w-4" aria-hidden /></button>
                            ) : null}
                          </span>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && companyId ? <VendorEditDialog companyId={companyId} vendor={editing} onClose={() => setEditing(null)} onSaved={() => {setEditing(null); reload(); notify('Vendor saved');}} wrap={wrap} /> : null}
      {invoiceFor && companyId ? <InvoiceDialog companyId={companyId} vendor={invoiceFor} branches={branches ?? []} onClose={() => setInvoiceFor(null)} onSaved={() => {setInvoiceFor(null); reload(); notify('Vendor invoice recorded');}} wrap={wrap} /> : null}
      {paymentFor && companyId ? <PaymentDialog companyId={companyId} vendor={paymentFor} branches={branches ?? []} onClose={() => setPaymentFor(null)} onSaved={() => {setPaymentFor(null); reload(); notify('Vendor payment recorded');}} wrap={wrap} /> : null}
    </div>
  );
}

type Wrap = (fn: () => Promise<void>, ok?: string) => () => Promise<void>;

// ─── Vendor Edit Dialog ──────────────────────────────────────────────────────
function VendorEditDialog({companyId, vendor, onClose, onSaved, wrap}: {companyId: string; vendor: Vendor; onClose: () => void; onSaved: () => void; wrap: Wrap}) {
  const isNew = !vendor.id;
  const [code, setCode] = useState(vendor.vendor_code);
  const [name, setName] = useState(vendor.name);
  const [contact, setContact] = useState(vendor.contact ?? '');
  const [address, setAddress] = useState(vendor.address ?? '');
  const [taxId, setTaxId] = useState(vendor.tax_id ?? '');
  const [terms, setTerms] = useState(vendor.payment_terms ?? '');
  const [notes, setNotes] = useState(vendor.notes ?? '');
  const onSubmit = wrap(async () => {
    await vendorsApi.upsert(companyId, vendor.id || null, code, name, contact || null, address || null, taxId || null, terms || null, notes || null);
    onSaved();
  }, isNew ? 'Vendor created' : 'Vendor updated');
  return (
    <Dialog.Root open onOpenChange={(o) => {if (!o) onClose();}}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-farm-card p-6 shadow-xl">
          <Dialog.Title className="mb-3 flex items-center gap-2 text-lg font-bold text-farm-green"><Truck className="h-5 w-5" aria-hidden /> {isNew ? 'New Vendor' : 'Edit Vendor'}</Dialog.Title>
          <div className="space-y-2 text-sm">
            <label className="block"><span className="text-xs text-farm-muted">Code</span><input value={code} onChange={(e) => setCode(e.target.value)} className="mt-0.5 w-full rounded border border-farm-accent px-2 py-1.5 text-sm" placeholder="VEND-001" /></label>
            <label className="block"><span className="text-xs text-farm-muted">Name (required)</span><input value={name} onChange={(e) => setName(e.target.value)} className="mt-0.5 w-full rounded border border-farm-accent px-2 py-1.5 text-sm" placeholder="Acme Farms" /></label>
            <label className="block"><span className="text-xs text-farm-muted">Contact</span><input value={contact} onChange={(e) => setContact(e.target.value)} className="mt-0.5 w-full rounded border border-farm-accent px-2 py-1.5 text-sm" /></label>
            <label className="block"><span className="text-xs text-farm-muted">Address</span><input value={address} onChange={(e) => setAddress(e.target.value)} className="mt-0.5 w-full rounded border border-farm-accent px-2 py-1.5 text-sm" /></label>
            <label className="block"><span className="text-xs text-farm-muted">Tax ID / TIN</span><input value={taxId} onChange={(e) => setTaxId(e.target.value)} className="mt-0.5 w-full rounded border border-farm-accent px-2 py-1.5 text-sm" /></label>
            <label className="block"><span className="text-xs text-farm-muted">Payment Terms</span><input value={terms} onChange={(e) => setTerms(e.target.value)} className="mt-0.5 w-full rounded border border-farm-accent px-2 py-1.5 text-sm" placeholder="Net 30 / COD" /></label>
            <label className="block"><span className="text-xs text-farm-muted">Notes</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-0.5 w-full rounded border border-farm-accent px-2 py-1.5 text-sm" rows={2} /></label>
          </div>
          <div className="mt-4 flex gap-2 border-t border-farm-accent-soft pt-4">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button className="flex-1" onClick={onSubmit} disabled={!code.trim() || !name.trim()}>Save</Button>
          </div>
          <Dialog.Close className="absolute right-3 top-3 rounded p-1 text-farm-muted hover:bg-farm-bg" aria-label="Close"><X className="h-4 w-4" /></Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ─── Invoice Record Dialog (T3.1) ────────────────────────────────────────────
function InvoiceDialog({companyId, vendor, branches, onClose, onSaved, wrap}: {companyId: string; vendor: Vendor; branches: Branch[]; onClose: () => void; onSaved: () => void; wrap: Wrap}) {
  const [branchId, setBranchId] = useState<string | undefined>(branches[0]?.id);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [today, setToday] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState(new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10));
  const [lines, setLines] = useState<Array<{description: string; quantity: string; unit_cost: string; expense_account: string}>>([{description: '', quantity: '1', unit_cost: '0', expense_account: 'OPERATING_EXPENSES'}]);
  const [notes, setNotes] = useState('');
  const updateLine = (i: number, k: 'description'|'quantity'|'unit_cost'|'expense_account', v: string) => setLines((arr) => arr.map((l, j) => j === i ? {...l, [k]: v} : l));
  const addLine = () => setLines((arr) => [...arr, {description: '', quantity: '1', unit_cost: '0', expense_account: 'OPERATING_EXPENSES'}]);
  const removeLine = (i: number) => setLines((arr) => arr.length === 1 ? arr : arr.filter((_, j) => j !== i));
  const total = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_cost) || 0), 0);
  const onSubmit = wrap(async () => {
    if (!branchId) throw new Error('Select a branch for this bill.');
    // expense_account is a CODE (OPERATING_EXPENSES, FG_INVENTORY, EQUIPMENT, ...) — server validates
    // the resolved account belongs to the same company and is Asset/Expense type. A company that has never
    // run a sale/purchase has no chart of accounts yet — seed it before looking codes up (idempotent).
    await supabase.rpc('inventory_ensure_accounts', {p_company: companyId});
    const {data: accts} = await supabase.from('chart_of_accounts').select('id, account_code').eq('company_id', companyId).eq('status', 'Active');
    const codeToId = new Map((accts ?? []).map((a: {account_code: string; id: string}) => [a.account_code, a.id]));
    const rpcLines = lines.map((l) => ({
      product_id: null, description: l.description, quantity: Number(l.quantity), unit_cost: Number(l.unit_cost),
      expense_account_id: codeToId.get(l.expense_account),
      cost_schedule_id: null,
    }));
    const missing = rpcLines.find((l) => !l.expense_account_id);
    if (missing) throw new Error('Expense account not found in chart of accounts.');
    await vendorsApi.recordInvoice(companyId, branchId, vendor.id, invoiceNumber, today, dueDate, rpcLines, notes || null);
    onSaved();
  }, 'Invoice recorded');
  return (
    <Dialog.Root open onOpenChange={(o) => {if (!o) onClose();}}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-2xl -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-farm-card p-6 shadow-xl">
          <Dialog.Title className="mb-3 flex items-center gap-2 text-lg font-bold text-farm-green"><FileText className="h-5 w-5" aria-hidden /> Record Invoice — {vendor.name}</Dialog.Title>
          <div className="grid grid-cols-4 gap-2 text-sm">
            <label className="block"><span className="text-xs text-farm-muted">Branch</span><SelectField value={branchId} onChange={setBranchId} placeholder="Branch" options={branches.map((b) => ({value: b.id, label: b.name}))} /></label>
            <label className="block"><span className="text-xs text-farm-muted">Invoice # (required)</span><input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} className="mt-0.5 w-full rounded border border-farm-accent px-2 py-1.5 text-sm" /></label>
            <label className="block"><span className="text-xs text-farm-muted">Invoice date</span><input type="date" value={today} onChange={(e) => setToday(e.target.value)} className="mt-0.5 w-full rounded border border-farm-accent px-2 py-1.5 text-sm" /></label>
            <label className="block"><span className="text-xs text-farm-muted">Due date</span><input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="mt-0.5 w-full rounded border border-farm-accent px-2 py-1.5 text-sm" /></label>
          </div>
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between">
              <h4 className="text-sm font-bold text-farm-ink">Lines</h4>
              <Button variant="secondary" onClick={addLine}><Plus className="mr-1 h-3.5 w-3.5" aria-hidden /> Add line</Button>
            </div>
            <table className="w-full text-xs">
              <thead><tr className="text-left text-farm-muted"><th className="px-1 py-1">Description</th><th className="px-1 py-1 w-16">Qty</th><th className="px-1 py-1 w-20">Unit ₱</th><th className="px-1 py-1 w-40">Expense Acct</th><th className="px-1 py-1 w-20 text-right">Line ₱</th><th className="px-1 py-1 w-6"></th></tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td className="px-1 py-1"><input value={l.description} onChange={(e) => updateLine(i, 'description', e.target.value)} className="w-full rounded border border-farm-accent px-1 py-1" /></td>
                    <td className="px-1 py-1"><input type="number" step="0.001" value={l.quantity} onChange={(e) => updateLine(i, 'quantity', e.target.value)} className="w-full rounded border border-farm-accent px-1 py-1 text-right tabular-nums" /></td>
                    <td className="px-1 py-1"><input type="number" step="0.01" value={l.unit_cost} onChange={(e) => updateLine(i, 'unit_cost', e.target.value)} className="w-full rounded border border-farm-accent px-1 py-1 text-right tabular-nums" /></td>
                    <td className="px-1 py-1">
                      <SelectField value={l.expense_account} onChange={(v) => updateLine(i, 'expense_account', v)} placeholder="Account" options={[
                        {value: 'OPERATING_EXPENSES', label: 'Operating Expenses'},
                        {value: 'FG_INVENTORY', label: 'FG Inventory'},
                        {value: 'RAW_MATERIALS', label: 'Raw Materials'},
                        {value: 'EQUIPMENT', label: 'Equipment'},
                      ]} />
                    </td>
                    <td className="px-1 py-1 text-right tabular-nums">{(Number(l.quantity) * Number(l.unit_cost)).toFixed(2)}</td>
                    <td className="px-1 py-1 text-right">{lines.length > 1 ? <button onClick={() => removeLine(i)} className="rounded p-0.5 text-farm-muted hover:bg-red-50 hover:text-farm-danger" aria-label="Remove line"><X className="h-3.5 w-3.5" /></button> : null}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={4} className="px-1 py-1 text-right text-xs font-bold">Total</td><td className="px-1 py-1 text-right tabular-nums font-bold">{total.toFixed(2)}</td><td /></tr></tfoot>
            </table>
          </div>
          <label className="mt-3 block text-sm"><span className="text-xs text-farm-muted">Notes</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="mt-0.5 w-full rounded border border-farm-accent px-2 py-1.5 text-sm" /></label>
          <div className="mt-4 flex gap-2 border-t border-farm-accent-soft pt-4">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button className="flex-1" onClick={onSubmit} disabled={!branchId || !invoiceNumber.trim() || total <= 0}>Record Invoice (₱{total.toFixed(2)})</Button>
          </div>
          <Dialog.Close className="absolute right-3 top-3 rounded p-1 text-farm-muted hover:bg-farm-bg" aria-label="Close"><X className="h-4 w-4" /></Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ─── Payment Record Dialog (T3.1, invoice picker added 2026-07-19) ──────────
interface OpenInvoice {id: string; invoice_number: string; invoice_date: string; outstanding: number;}

function PaymentDialog({companyId, vendor, branches, onClose, onSaved, wrap}: {companyId: string; vendor: VendorAPStanding; branches: Branch[]; onClose: () => void; onSaved: () => void; wrap: Wrap}) {
  const [branchId, setBranchId] = useState<string | undefined>(branches[0]?.id);
  const [today] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState(vendor.outstanding_ap.toFixed(2));
  const [method, setMethod] = useState('Bank');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [openInvs, setOpenInvs] = useState<OpenInvoice[] | null>(null);
  const [applied, setApplied] = useState<Record<string, string>>({}); // invoice id -> amount typed

  useEffect(() => {
    supabase.from('vendor_invoices').select('id, invoice_number, invoice_date, total, paid_amount')
      .eq('company_id', companyId).eq('vendor_id', vendor.vendor_id).in('status', ['Approved', 'Partial']).order('invoice_date')
      .then(({data}) => setOpenInvs((data ?? []).map((r) => ({id: r.id, invoice_number: r.invoice_number, invoice_date: r.invoice_date, outstanding: Number(r.total) - Number(r.paid_amount)}))));
  }, [companyId, vendor.vendor_id]);

  const totalApplied = Object.values(applied).reduce((s, v) => s + (Number(v) || 0), 0);

  // Convenience: distribute the entered amount oldest-invoice-first (still just fills the per-row inputs — the
  // owner picks/edits before submitting, this isn't a hidden auto-allocation like the old behavior was).
  const fillOldestFirst = () => {
    if (!openInvs) return;
    let remaining = Number(amount) || 0;
    const next: Record<string, string> = {};
    for (const inv of openInvs) {
      if (remaining <= 0.005) break;
      const take = Math.min(remaining, inv.outstanding);
      if (take > 0) {next[inv.id] = take.toFixed(2); remaining -= take;}
    }
    setApplied(next);
  };

  const onSubmit = wrap(async () => {
    if (!branchId) throw new Error('Select a branch for this payment.');
    const allocations = Object.entries(applied)
      .map(([vendor_invoice_id, v]) => ({vendor_invoice_id, amount: Number(v) || 0}))
      .filter((a) => a.amount > 0);
    if (allocations.length === 0) throw new Error('Apply the payment to at least one invoice.');
    if (Math.abs(totalApplied - Number(amount)) > 0.005) throw new Error(`Applied amount (₱${totalApplied.toFixed(2)}) must equal the payment amount (₱${Number(amount).toFixed(2)}).`);
    await vendorsApi.recordPayment(companyId, branchId, vendor.vendor_id, today, Number(amount), allocations, method, reference || null, notes || null);
    onSaved();
  }, 'Payment recorded');
  return (
    <Dialog.Root open onOpenChange={(o) => {if (!o) onClose();}}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-farm-card p-6 shadow-xl">
          <Dialog.Title className="mb-3 flex items-center gap-2 text-lg font-bold text-farm-green"><Wallet className="h-5 w-5" aria-hidden /> Record Payment — {vendor.name}</Dialog.Title>
          <p className="mb-3 text-xs text-farm-muted">Outstanding AP for this vendor: <span className="font-bold text-farm-danger">{formatPeso(vendor.outstanding_ap)}</span>. Pick which invoice(s) this payment settles.</p>
          <div className="space-y-2 text-sm">
            <label className="block"><span className="text-xs text-farm-muted">Branch</span><SelectField value={branchId} onChange={setBranchId} placeholder="Branch" options={branches.map((b) => ({value: b.id, label: b.name}))} /></label>
            <label className="block"><span className="text-xs text-farm-muted">Amount ₱ (required)</span><input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-0.5 w-full rounded border border-farm-accent px-2 py-1.5 text-sm" /></label>
            <label className="block"><span className="text-xs text-farm-muted">Method</span>
              <SelectField value={method} onChange={setMethod} placeholder="Method" options={[
                {value: 'Cash', label: 'Cash'}, {value: 'Bank', label: 'Bank'}, {value: 'Check', label: 'Check'}, {value: 'Other', label: 'Other'},
              ]} />
            </label>
            <label className="block"><span className="text-xs text-farm-muted">Reference (check # / txn id)</span><input value={reference} onChange={(e) => setReference(e.target.value)} className="mt-0.5 w-full rounded border border-farm-accent px-2 py-1.5 text-sm" /></label>
            <label className="block"><span className="text-xs text-farm-muted">Notes</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="mt-0.5 w-full rounded border border-farm-accent px-2 py-1.5 text-sm" /></label>
          </div>
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between">
              <h4 className="text-sm font-bold text-farm-ink">Apply to invoice(s)</h4>
              <button type="button" onClick={fillOldestFirst} className="text-xs font-semibold text-farm-green hover:underline">Fill oldest-first</button>
            </div>
            {openInvs === null ? (
              <Skeleton rows={2} />
            ) : openInvs.length === 0 ? (
              <p className="text-xs text-farm-muted">No open invoices for this vendor.</p>
            ) : (
              <table className="w-full text-xs">
                <thead><tr className="text-left text-farm-muted"><th className="px-1 py-1">Invoice</th><th className="px-1 py-1">Date</th><th className="px-1 py-1 text-right">Outstanding</th><th className="px-1 py-1 w-24 text-right">Apply ₱</th></tr></thead>
                <tbody>
                  {openInvs.map((inv) => (
                    <tr key={inv.id} className="border-t border-farm-accent-soft/50">
                      <td className="px-1 py-1 font-mono">{inv.invoice_number}</td>
                      <td className="px-1 py-1">{inv.invoice_date}</td>
                      <td className="px-1 py-1 text-right tabular-nums">{formatPeso(inv.outstanding)}</td>
                      <td className="px-1 py-1">
                        <input type="number" step="0.01" min="0" max={inv.outstanding}
                          value={applied[inv.id] ?? ''}
                          onChange={(e) => setApplied((a) => ({...a, [inv.id]: e.target.value}))}
                          className="w-full rounded border border-farm-accent px-1 py-1 text-right tabular-nums" placeholder="0.00" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className={`mt-1 text-right text-xs font-bold ${Math.abs(totalApplied - Number(amount)) > 0.005 ? 'text-farm-danger' : 'text-farm-green'}`}>
              Applied: {formatPeso(totalApplied)} / {formatPeso(Number(amount) || 0)}
            </p>
          </div>
          <div className="mt-4 flex gap-2 border-t border-farm-accent-soft pt-4">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button className="flex-1" onClick={onSubmit} disabled={!branchId || !Number(amount) || Number(amount) <= 0 || Math.abs(totalApplied - Number(amount)) > 0.005}>Record Payment</Button>
          </div>
          <Dialog.Close className="absolute right-3 top-3 rounded p-1 text-farm-muted hover:bg-farm-bg" aria-label="Close"><X className="h-4 w-4" /></Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
