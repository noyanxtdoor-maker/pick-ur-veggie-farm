// Cash & Accounts (P2-B2A / backlog B2 §4.5) — every monetary account (drawer / bank / e-wallet) with its
// DERIVED balance (20.24: no stored balance, ever), plus governed transfer and account CRUD. Read needs
// finance.account.read; create/edit/archive/transfer need finance.account.manage (server RLS is the gate).
import {useCallback, useEffect, useState} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {ArrowRightLeft, Landmark, Plus, Smartphone, Wallet, X} from 'lucide-react';
import {useSync} from '../../core/offline/sync';
import {usePermissions} from '../../core/permissions/permissions';
import {Button, Card, cn} from '../../components/ui';
import {EmptyState, useToast} from '../../components/feedback';
import {SelectField} from '../../components/overlay';
import {paymentsApi, type AccountWithBalance} from '../finance/api';
import {formatPeso} from '../pos/money';
import type {FinancialAccount} from '../../types/db';

const TYPE_ICON = {Cash: Wallet, Bank: Landmark, 'Digital Wallet': Smartphone} as const;
const TYPES: FinancialAccount['account_type'][] = ['Digital Wallet', 'Bank', 'Cash'];

// suggest a COA code from the name: "GCash Wallet" → WALLET_GCASH-style is the owner's call; default = sanitized name
const suggestCode = (name: string, type: FinancialAccount['account_type']) => {
  const base = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24);
  const prefix = type === 'Bank' ? 'BANK' : type === 'Digital Wallet' ? 'WALLET' : 'CASHBOX';
  return base ? `${prefix}_${base}`.slice(0, 31) : '';
};

export function AccountsTab({branchId}: {branchId: string | null}) {
  const {companyId, has} = usePermissions();
  const {refreshTick} = useSync();
  const {notify} = useToast();
  const canRead = has('finance.account.read');
  const canManage = has('finance.account.manage');

  const [accounts, setAccounts] = useState<AccountWithBalance[] | null>(null);
  const [busy, setBusy] = useState(false);
  const reload = useCallback(() => {
    if (!companyId || !canRead) return;
    paymentsApi.fetchAccounts(companyId, branchId ?? undefined).then(setAccounts).catch(() => setAccounts([]));
  }, [companyId, branchId, canRead]);
  useEffect(reload, [reload, refreshTick]);

  // create / edit modal
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<FinancialAccount | null>(null);
  const [fName, setFName] = useState('');
  const [fType, setFType] = useState<FinancialAccount['account_type']>('Digital Wallet');
  const [fProvider, setFProvider] = useState('');
  const [fNumber, setFNumber] = useState('');
  const [fCode, setFCode] = useState('');
  const [codeTouched, setCodeTouched] = useState(false);

  function openCreate() {
    setEditing(null); setFName(''); setFType('Digital Wallet'); setFProvider(''); setFNumber(''); setFCode(''); setCodeTouched(false); setOpen(true);
  }
  function openEdit(a: FinancialAccount) {
    setEditing(a); setFName(a.name); setFType(a.account_type); setFProvider(a.provider ?? ''); setFNumber(a.account_number ?? ''); setFCode(a.coa_code); setCodeTouched(true); setOpen(true);
  }
  async function submitAccount() {
    if (!companyId || !branchId) return notify('Pick a branch first.', 'error');
    setBusy(true);
    try {
      await paymentsApi.upsertAccount(companyId, branchId,
        {name: fName, account_type: fType, coa_code: fCode, provider: fProvider.trim() || null, account_number: fNumber.trim() || null},
        editing?.id);
      notify(editing ? 'Account updated' : 'Account added');
      setOpen(false); reload();
    } catch (e) { notify(e instanceof Error ? e.message : 'Failed to save', 'error'); } finally { setBusy(false); }
  }

  // transfer modal
  const [xferOpen, setXferOpen] = useState(false);
  const [xFrom, setXFrom] = useState('');
  const [xTo, setXTo] = useState('');
  const [xAmount, setXAmount] = useState('');
  const [xNote, setXNote] = useState('');
  const active = (accounts ?? []).filter((a) => a.status === 'Active');
  async function submitTransfer() {
    if (!companyId) return;
    const from = active.find((a) => a.id === xFrom);
    const to = active.find((a) => a.id === xTo);
    const amt = parseFloat(xAmount) || 0;
    if (!from || !to) return notify('Pick both accounts.', 'error');
    setBusy(true);
    try {
      await paymentsApi.transfer(companyId, from, to, amt, xNote);
      notify(`Moved ${formatPeso(amt)} — ${from.name} → ${to.name}`);
      setXferOpen(false); setXFrom(''); setXTo(''); setXAmount(''); setXNote(''); reload();
    } catch (e) { notify(e instanceof Error ? e.message : 'Transfer failed', 'error'); } finally { setBusy(false); }
  }

  async function registerDrawer() {
    if (!companyId || !branchId) return notify('Pick a branch first.', 'error');
    setBusy(true);
    try { await paymentsApi.ensureCash(companyId, branchId); notify('Cash drawer registered'); reload(); }
    catch (e) { notify(e instanceof Error ? e.message : 'Failed', 'error'); } finally { setBusy(false); }
  }

  if (!canRead) {
    return <Card><EmptyState title="Accounts access needed" hint="Your role does not include the finance.account.read permission." /></Card>;
  }

  const total = (accounts ?? []).filter((a) => a.status === 'Active').reduce((s, a) => s + a.balance, 0);
  const hasDrawer = (accounts ?? []).some((a) => a.coa_code === 'CASH');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-bold uppercase text-farm-muted">Cash &amp; equivalents{branchId ? '' : ' — all branches'}</p>
          <p className="tabular text-2xl font-black text-farm-green">{formatPeso(total)}</p>
          <p className="text-[11px] text-farm-muted">Every balance is derived from the posted ledger — nothing here is typed in by hand.</p>
        </div>
        {canManage ? (
          <div className="flex gap-2">
            {!hasDrawer ? <Button variant="secondary" onClick={() => void registerDrawer()} disabled={busy || !branchId}>Register cash drawer</Button> : null}
            <Button variant="secondary" onClick={() => {setXferOpen(true);}} disabled={busy || active.length < 2}><ArrowRightLeft size={16} aria-hidden /> Transfer</Button>
            <Button onClick={openCreate} disabled={busy || !branchId}><Plus size={16} aria-hidden /> Add account</Button>
          </div>
        ) : null}
      </div>

      {accounts === null ? (
        <Card><p className="py-6 text-center text-sm italic text-farm-muted">Loading…</p></Card>
      ) : accounts.length === 0 ? (
        <Card><EmptyState title="No accounts yet" hint={canManage ? 'Register the cash drawer, then add your GCash / Maya / bank accounts.' : 'Ask a manager to set up the money accounts.'} /></Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.map((a) => {
            const Icon = TYPE_ICON[a.account_type];
            return (
              <Card key={a.id} className={cn(a.status === 'Archived' && 'opacity-50')}>
                <div className="flex items-start justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-bold text-farm-ink">
                    <Icon className="h-4 w-4 shrink-0 text-farm-green" aria-hidden />
                    <span className="truncate">{a.name}</span>
                  </span>
                  <span className="rounded bg-farm-accent-soft px-1.5 py-0.5 text-[9px] font-black uppercase text-farm-green">{a.account_type}</span>
                </div>
                <p className="tabular mt-2 text-2xl font-black text-farm-green">{formatPeso(a.balance)}</p>
                <p className="mt-0.5 truncate text-[11px] text-farm-muted">
                  {a.provider ? `${a.provider} · ` : ''}{a.account_number ?? a.coa_code}{a.status === 'Archived' ? ' · Archived' : ''}
                </p>
                {canManage ? (
                  <div className="mt-3 flex gap-1.5 border-t border-farm-accent-soft pt-2.5">
                    <button onClick={() => openEdit(a)} className="rounded px-2 py-1 text-xs font-bold text-farm-green hover:bg-farm-accent-soft">Edit</button>
                    {a.coa_code !== 'CASH' ? (
                      <button onClick={async () => {if (!companyId) return; setBusy(true); try {await paymentsApi.setAccountStatus(companyId, a, a.status === 'Active' ? 'Archived' : 'Active'); notify(a.status === 'Active' ? 'Archived' : 'Reactivated'); reload();} catch (e) {notify(e instanceof Error ? e.message : 'Failed', 'error');} finally {setBusy(false);}}}
                        className="rounded px-2 py-1 text-xs font-bold text-farm-muted hover:bg-farm-accent-soft" disabled={busy}>
                        {a.status === 'Active' ? 'Archive' : 'Reactivate'}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}

      {/* create / edit account */}
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-farm-card p-6 shadow-xl">
            <div className="mb-1 flex items-center justify-between">
              <Dialog.Title className="text-xl font-bold text-farm-green">{editing ? 'Edit Account' : 'Add Money Account'}</Dialog.Title>
              <Dialog.Close className="rounded p-1 text-farm-muted hover:text-farm-ink" aria-label="Close"><X size={20} aria-hidden /></Dialog.Close>
            </div>
            <p className="mb-5 text-xs text-farm-muted">{editing ? 'Display details only — the ledger code never changes once money has moved through it.' : 'A GCash / Maya wallet or bank account this branch receives money into.'}</p>
            <div className="space-y-4 text-sm">
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="fa-name">Name</label>
                <input id="fa-name" value={fName} onChange={(e) => {setFName(e.target.value); if (!editing && !codeTouched) setFCode(suggestCode(e.target.value, fType));}} placeholder="e.g. GCash Main" className="min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted">Type</label>
                  {editing ? (
                    <p className="flex min-h-12 items-center rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm font-semibold text-farm-muted">{fType}</p>
                  ) : (
                    <SelectField value={fType} onChange={(v) => {const t = v as FinancialAccount['account_type']; setFType(t); if (!codeTouched) setFCode(suggestCode(fName, t));}} options={TYPES.map((t) => ({value: t, label: t}))} />
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="fa-provider">Provider</label>
                  <input id="fa-provider" value={fProvider} onChange={(e) => setFProvider(e.target.value)} placeholder="GCash / Maya / BPI" className="min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="fa-number">Account / mobile number <span className="normal-case text-farm-muted/70">(display only)</span></label>
                <input id="fa-number" value={fNumber} onChange={(e) => setFNumber(e.target.value)} placeholder="0917-xxx-xxxx" className="min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="fa-code">Ledger code</label>
                <input id="fa-code" value={fCode} onChange={(e) => {setFCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '')); setCodeTouched(true);}} placeholder="WALLET_GCASH" disabled={!!editing} className={cn('min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 font-mono text-sm', editing && 'opacity-60')} />
                <p className="mt-1 text-[10px] text-farm-muted">{editing ? 'Locked — journal history stays attached to this code.' : 'Where this account lives in the books. Auto-suggested; fixed after creation.'}</p>
              </div>
            </div>
            <div className="mt-5 flex gap-2 border-t border-farm-accent-soft pt-4">
              <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
              <Button className="flex-1" onClick={() => void submitAccount()} disabled={busy || !fName.trim() || (!editing && fCode.length < 3)}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Add account'}</Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* transfer between accounts */}
      <Dialog.Root open={xferOpen} onOpenChange={setXferOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-farm-card p-6 shadow-xl">
            <div className="mb-1 flex items-center justify-between">
              <Dialog.Title className="text-xl font-bold text-farm-green">Transfer Between Accounts</Dialog.Title>
              <Dialog.Close className="rounded p-1 text-farm-muted hover:text-farm-ink" aria-label="Close"><X size={20} aria-hidden /></Dialog.Close>
            </div>
            <p className="mb-5 text-xs text-farm-muted">Moves money between two accounts of the same branch — no income, no expense, just where it sits (e.g. deposit drawer cash into GCash).</p>
            <div className="space-y-4 text-sm">
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted">From</label>
                <SelectField value={xFrom} onChange={setXFrom} placeholder="Source account" options={active.map((a) => ({value: a.id, label: `${a.name} — ${formatPeso(a.balance)}`}))} />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted">To</label>
                <SelectField value={xTo} onChange={setXTo} placeholder="Destination account" options={active.filter((a) => a.id !== xFrom).map((a) => ({value: a.id, label: `${a.name} — ${formatPeso(a.balance)}`}))} />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="fa-amount">Amount (₱)</label>
                <input id="fa-amount" value={xAmount} onChange={(e) => setXAmount(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder="0.00" className="tabular min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-right text-lg font-black" />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="fa-note">Note</label>
                <input id="fa-note" value={xNote} onChange={(e) => setXNote(e.target.value)} placeholder="optional" className="min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm" />
              </div>
            </div>
            <div className="mt-5 flex gap-2 border-t border-farm-accent-soft pt-4">
              <Button variant="secondary" onClick={() => setXferOpen(false)} disabled={busy}>Cancel</Button>
              <Button className="flex-1" onClick={() => void submitTransfer()} disabled={busy || !xFrom || !xTo || !(parseFloat(xAmount) > 0)}>{busy ? 'Moving…' : 'Move money'}</Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
