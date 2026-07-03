// Customers & Credit (P2-M9A / B1) — customer master + read-only receivable/credit standing, and attribution of
// unpaid credit sales to a customer (non-money: no GL, no amount change). Credit-limit ENFORCEMENT in the sale is
// deferred to the pending money-path review (spec §Deferred). All writes via customersApi (RLS-gated; B5-queued).
import {useCallback, useEffect, useState} from 'react';
import {useLiveQuery} from 'dexie-react-hooks';
import * as Dialog from '@radix-ui/react-dialog';
import {Archive, CreditCard, Pencil, Plus, UserPlus, Users2, X} from 'lucide-react';
import {offlineDB} from '../../core/offline/db';
import {usePermissions} from '../../core/permissions/permissions';
import {Button, Card, PageHeader, cn} from '../../components/ui';
import {EmptyState, Skeleton, useToast} from '../../components/feedback';
import {SelectField} from '../../components/overlay';
import {formatPeso} from '../pos/money';
import {customersApi, type CustomerInput} from './api';
import type {Customer, CustomerStanding, PosInvoice} from '../../types/db';

export default function CustomersScreen() {
  const {companyId, has} = usePermissions();
  const {notify} = useToast();
  const canRead = has('customer.read');
  const canManage = has('customer.manage');

  const branches = useLiveQuery(async () => (companyId ? offlineDB.branches.where('company_id').equals(companyId).filter((b) => b.status === 'Active').toArray() : []), [companyId]);
  const [branchId, setBranchId] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!branchId && branches && branches.length > 0) setBranchId(branches[0]!.id);
  }, [branches, branchId]);

  const [standing, setStanding] = useState<CustomerStanding[] | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [unassigned, setUnassigned] = useState<PosInvoice[]>([]);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    if (!companyId || !canRead) return;
    customersApi.fetchStanding(companyId).then(setStanding).catch(() => setStanding([]));
    customersApi.fetchCustomers(companyId).then(setCustomers).catch(() => setCustomers([]));
    customersApi.fetchUnassignedCredit(companyId, branchId).then(setUnassigned).catch(() => setUnassigned([]));
  }, [companyId, canRead, branchId]);
  useEffect(reload, [reload]);

  const wrap = (fn: () => Promise<void>, ok?: string) => async () => {
    setBusy(true);
    try { await fn(); if (ok) notify(ok); reload(); }
    catch (e) { notify(e instanceof Error ? e.message : 'Failed', 'error'); }
    finally { setBusy(false); }
  };

  // create / edit modal
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [fName, setFName] = useState('');
  const [fContact, setFContact] = useState('');
  const [fLimit, setFLimit] = useState('');
  const [fNotes, setFNotes] = useState('');

  function openCreate() {
    setEditId(null); setFName(''); setFContact(''); setFLimit(''); setFNotes(''); setOpen(true);
  }
  function openEdit(c: Customer) {
    setEditId(c.id); setFName(c.name); setFContact(c.contact ?? ''); setFLimit(c.credit_limit == null ? '' : String(c.credit_limit)); setFNotes(c.notes ?? ''); setOpen(true);
  }
  async function submit() {
    if (!companyId) return;
    const input: CustomerInput = {name: fName, contact: fContact, notes: fNotes, credit_limit: fLimit.trim() === '' ? null : parseFloat(fLimit)};
    setBusy(true);
    try {
      await customersApi.upsert(companyId, editId, input);
      notify(editId ? 'Customer updated' : 'Customer created');
      setOpen(false); reload();
    } catch (e) { notify(e instanceof Error ? e.message : 'Failed', 'error'); } finally { setBusy(false); }
  }

  if (!canRead) {
    return (
      <div>
        <PageHeader title="Customers &amp; Credit" />
        <Card><EmptyState title="Customer access needed" hint="Your role does not include the customer.read permission." /></Card>
      </div>
    );
  }

  const activeCustomerOptions = customers.filter((c) => c.status === 'Active').map((c) => ({value: c.id, label: c.name}));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers &amp; Credit"
        subtitle="Track regular buyers and their outstanding receivables against an optional credit limit."
        action={canManage ? <Button onClick={openCreate}><Plus size={18} aria-hidden /> New Customer</Button> : undefined}
      />

      {standing === null ? (
        <Skeleton rows={4} />
      ) : standing.length === 0 ? (
        <Card><EmptyState title="No customers yet" hint={canManage ? 'Add one with "New Customer".' : 'None recorded.'} /></Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {standing.map((s) => {
            const customer = customers.find((c) => c.id === s.customer_id);
            const pct = s.credit_limit && s.credit_limit > 0 ? Math.min(100, Math.round((s.outstanding_ar / s.credit_limit) * 100)) : 0;
            const over = s.available_credit !== null && s.available_credit < 0;
            return (
              <Card key={s.customer_id} className={cn('flex flex-col', s.status === 'Archived' && 'opacity-60')}>
                <div className="mb-2 flex items-start justify-between gap-2">
                  <h3 className="flex items-center gap-1.5 text-base font-bold text-farm-green"><CreditCard className="h-4 w-4 shrink-0" aria-hidden /> {s.name}</h3>
                  {canManage && customer ? (
                    <span className="flex flex-shrink-0 items-center gap-1">
                      <button onClick={() => openEdit(customer)} className="rounded p-1 text-farm-muted hover:bg-farm-bg hover:text-farm-green" aria-label="Edit customer"><Pencil className="h-4 w-4" aria-hidden /></button>
                      <button onClick={() => void wrap(() => customersApi.setStatus(customer, customer.status === 'Active' ? 'Archived' : 'Active'), 'Updated')()} className="rounded p-1 text-farm-muted hover:bg-farm-bg hover:text-farm-green" aria-label="Archive customer"><Archive className="h-4 w-4" aria-hidden /></button>
                    </span>
                  ) : <span className="rounded-full bg-farm-accent-soft px-2 py-0.5 text-[10px] font-bold text-farm-green">{s.status}</span>}
                </div>
                {customer?.contact ? <p className="mb-2 text-xs text-farm-muted">{customer.contact}</p> : null}
                <dl className="mt-1 space-y-1 text-sm">
                  <div className="flex justify-between"><dt className="text-farm-muted">Outstanding AR</dt><dd className={cn('tabular font-bold', s.outstanding_ar > 0 ? 'text-farm-ink' : 'text-farm-muted')}>{formatPeso(s.outstanding_ar)}</dd></div>
                  <div className="flex justify-between"><dt className="text-farm-muted">Credit limit</dt><dd className="tabular font-semibold text-farm-muted">{s.credit_limit === null ? 'No limit' : formatPeso(s.credit_limit)}</dd></div>
                  <div className="flex justify-between"><dt className="text-farm-muted">Available credit</dt><dd className={cn('tabular font-bold', over ? 'text-farm-danger' : 'text-farm-green')}>{s.available_credit === null ? '—' : formatPeso(s.available_credit)}</dd></div>
                </dl>
                {s.credit_limit && s.credit_limit > 0 ? (
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-farm-accent-soft"><div className={cn('h-full rounded-full', over ? 'bg-farm-danger' : 'bg-farm-green')} style={{width: `${pct}%`}} /></div>
                ) : null}
                {over ? <p className="mt-1 text-[11px] font-bold text-farm-danger">Over credit limit</p> : null}
              </Card>
            );
          })}
        </div>
      )}

      {/* Attribute unpaid credit sales to a customer (non-money) */}
      {canManage && unassigned.length > 0 && activeCustomerOptions.length > 0 ? (
        <Card>
          <h3 className="mb-1 flex items-center gap-2 text-base font-bold text-farm-green"><UserPlus className="h-5 w-5" aria-hidden /> Unassigned credit sales</h3>
          <p className="mb-3 text-xs text-farm-muted">Link an unpaid pre-order to a customer so it counts toward their receivable. This only tags the sale — it posts no new ledger entry.</p>
          <ul className="divide-y divide-farm-accent-soft">
            {unassigned.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="font-semibold text-farm-ink">Invoice {inv.invoice_number ?? '(pending)'} <span className="tabular ml-2 font-bold">{formatPeso(inv.total)}</span> <span className="ml-2 text-xs text-farm-muted">{new Date(inv.created_at).toLocaleDateString()}</span></span>
                <div className="w-56"><SelectField value="" placeholder="Assign to customer…" onChange={(v) => v && void wrap(() => customersApi.assignInvoice(inv.company_id, inv.id, v), 'Sale assigned')()} options={activeCustomerOptions} /></div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* Create / edit modal */}
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-1 flex items-center justify-between">
              <Dialog.Title className="text-xl font-bold text-farm-green">{editId ? 'Edit Customer' : 'New Customer'}</Dialog.Title>
              <Dialog.Close className="rounded p-1 text-farm-muted hover:text-farm-ink" aria-label="Close"><X size={20} aria-hidden /></Dialog.Close>
            </div>
            <p className="mb-5 flex items-center gap-1.5 text-xs text-farm-muted"><Users2 className="h-3.5 w-3.5" aria-hidden /> Master record only — receivables are derived from their credit sales.</p>
            <div className="space-y-4 text-sm">
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="c-name">Name</label>
                <input id="c-name" value={fName} onChange={(e) => setFName(e.target.value)} placeholder="e.g. Aling Nena Store" className="min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="c-contact">Contact</label>
                <input id="c-contact" value={fContact} onChange={(e) => setFContact(e.target.value)} placeholder="phone / note (optional)" className="min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="c-limit">Credit limit (₱)</label>
                <input id="c-limit" value={fLimit} onChange={(e) => setFLimit(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder="blank = no limit" className="tabular min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="c-notes">Notes</label>
                <input id="c-notes" value={fNotes} onChange={(e) => setFNotes(e.target.value)} placeholder="optional" className="min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm" />
              </div>
            </div>
            <div className="mt-5 flex gap-2 border-t border-farm-accent-soft pt-4">
              <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
              <Button className="flex-1" onClick={() => void submit()} disabled={busy || !fName.trim()}>{busy ? 'Saving…' : editId ? 'Save changes' : 'Create Customer'}</Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
