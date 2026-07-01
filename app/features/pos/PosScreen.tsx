// Weigh Point-of-Sale (P2-M2B-2) — the cashier terminal, styled to the AI Studio prototype (visual authority,
// owner decision 2026-06-28). Two-pane landscape: LEFT = crop cashier grid + weigh pad; RIGHT = Active Slip
// Counter → cash checkout → printable slip (pane swap, no modals). Below: the Historical Sales Journal.
// Sale commits via posApi.recordSale (server price authority; offline-queued per B5).
import {useCallback, useEffect, useMemo, useState} from 'react';
import {useLiveQuery} from 'dexie-react-hooks';
import {AlertCircle, Banknote, CloudOff, Printer, Scale, ShoppingCart, Sprout, Trash2} from 'lucide-react';
import {offlineDB} from '../../core/offline/db';
import {usePermissions} from '../../core/permissions/permissions';
import {useSync} from '../../core/offline/sync';
import {Button, Card, PageHeader, cn} from '../../components/ui';
import {EmptyState, Skeleton, useToast} from '../../components/feedback';
import {SelectField} from '../../components/overlay';
import {Numpad} from './Numpad';
import {posApi, type SaleLineInput, type SaleResult} from './api';
import {formatPeso, lineTotal, round2} from './money';
import type {FinishedGood, Product} from '../../types/db';

type RightPane = 'slip' | 'checkout' | 'receipt';

export default function PosScreen() {
  const {companyId, has} = usePermissions();
  const {online, triggerSync} = useSync();
  const {notify} = useToast();
  const canSell = has('pos.sell');

  const branches = useLiveQuery(async () => (companyId ? offlineDB.branches.where('company_id').equals(companyId).filter((b) => b.status === 'Active').toArray() : []), [companyId]);
  const [branchId, setBranchId] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!branchId && branches && branches.length > 0) setBranchId(branches[0]!.id);
  }, [branches, branchId]);

  const [products, setProducts] = useState<Product[] | null>(null);
  const [stock, setStock] = useState<FinishedGood[]>([]);
  const reload = useCallback(() => {
    if (!companyId || !branchId) return;
    posApi.fetchProducts(companyId).then(setProducts).catch(() => setProducts([]));
    posApi.fetchStock(companyId, branchId).then(setStock).catch(() => setStock([]));
  }, [companyId, branchId]);
  useEffect(reload, [reload]);

  const [selected, setSelected] = useState<Product | null>(null);
  const [weight, setWeight] = useState('');
  const [basket, setBasket] = useState<SaleLineInput[]>([]);
  const [pane, setPane] = useState<RightPane>('slip');
  const [cash, setCash] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastSale, setLastSale] = useState<SaleResult | null>(null);

  // journal filters (prototype: date + status)
  const [journalDate, setJournalDate] = useState('');
  const [journalStatus, setJournalStatus] = useState('all');
  const invoices = useLiveQuery(
    async () => (companyId ? offlineDB.posInvoices.where('company_id').equals(companyId).reverse().sortBy('created_at') : []),
    [companyId],
  );

  const claimed = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of basket) m.set(l.finished_goods_batch_id, (m.get(l.finished_goods_batch_id) ?? 0) + l.weight_kg);
    return m;
  }, [basket]);
  const availableFor = useCallback(
    (productId: string) => stock.filter((f) => f.product_id === productId).reduce((s, f) => s + f.available - (claimed.get(f.id) ?? 0), 0),
    [stock, claimed],
  );

  function addToSlip() {
    if (!selected) return;
    const w = parseFloat(weight);
    if (isNaN(w) || w <= 0) return notify('Enter a weight greater than 0 kg.', 'error');
    const batch = stock.find((f) => f.product_id === selected.id && f.available - (claimed.get(f.id) ?? 0) >= w);
    if (!batch) return notify(`Not enough ${selected.name} stock for ${w} kg.`, 'error');
    setBasket([...basket, {product_id: selected.id, finished_goods_batch_id: batch.id, name: selected.name, weight_kg: w, unit_price: selected.retail_per_kg}]);
    setSelected(null);
    setWeight('');
  }

  const total = round2(basket.reduce((s, l) => s + lineTotal(l.weight_kg, l.unit_price), 0));
  const cashNum = parseFloat(cash) || 0;

  async function commitSale() {
    if (busy || !companyId || !branchId || basket.length === 0) return;
    setBusy(true); // O4 double-submit guard
    try {
      const result = await posApi.recordSale(companyId, branchId, basket, cashNum);
      setLastSale(result);
      setBasket([]);
      setCash('');
      setPane('receipt');
      if (result.provisional) triggerSync();
      reload();
      notify(result.provisional ? 'Sale saved offline — will sync' : `Sale recorded — slip #${result.invoice.invoice_number ?? '—'}`);
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Sale failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!canSell) {
    return (
      <div>
        <PageHeader title="Weigh POS Terminal" />
        <Card><EmptyState title="POS access needed" hint="Your role does not include the pos.sell permission. Ask a manager to grant it." /></Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Weigh POS Terminal"
        subtitle="High contrast, glove-friendly weighing terminal for daily crop sales"
        action={
          <div className="w-56">
            <SelectField value={branchId} onChange={(v) => {setBranchId(v); setBasket([]);}} placeholder="Branch" options={(branches ?? []).map((b) => ({value: b.id, label: b.name}))} />
          </div>
        }
      />
      {!online ? (
        <p className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-base font-bold text-amber-900"><CloudOff size={18} aria-hidden /> POS Mode: Active Offline — sales are saved on this device and sync automatically.</p>
      ) : null}

      <div className="flex flex-col gap-6 xl:flex-row">
        {/* LEFT — crop cashier grid + weigh pad */}
        <div className="flex-1 space-y-6">
          <Card>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-lg font-bold text-farm-green"><ShoppingCart className="h-5 w-5" aria-hidden /> Vegetable Cashier Grid</h3>
              <span className="rounded-full bg-farm-accent-soft px-3 py-1 text-xs font-bold text-farm-green">{online ? 'POS Mode: Live' : 'POS Mode: Active Offline'}</span>
            </div>
            {products === null ? (
              <Skeleton rows={3} />
            ) : products.length === 0 ? (
              <EmptyState title="No products yet" hint="Add vegetables and prices to the price book first." />
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                {products.map((p, idx) => {
                  const avail = availableFor(p.id);
                  const out = avail <= 0;
                  return (
                    <button
                      key={p.id}
                      onClick={() => {setSelected(p); setWeight('');}}
                      disabled={out}
                      className={cn(
                        'group relative flex h-40 flex-col items-center justify-center gap-2 rounded-2xl border p-3 text-center transition select-none',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-farm-green-500',
                        selected?.id === p.id ? 'border-farm-green bg-farm-accent-soft shadow-sm ring-2 ring-farm-green' : 'border-farm-accent-soft bg-white hover:border-farm-green hover:bg-farm-bg/50',
                        out && 'cursor-not-allowed opacity-40',
                      )}
                    >
                      <span className="absolute right-2 top-2 rounded bg-farm-accent-soft px-1.5 py-0.5 font-mono text-[9px] font-black text-farm-green">#{101 + idx}</span>
                      <span className="flex h-14 w-14 items-center justify-center rounded-full border border-farm-accent-soft bg-farm-accent-soft text-farm-green transition-transform group-hover:scale-105">
                        <Sprout className="h-6 w-6" aria-hidden />
                      </span>
                      <span className="w-full">
                        <span className="block truncate text-sm font-extrabold leading-tight text-farm-ink">{p.name}</span>
                        <span className="mt-1 block text-xs font-black text-farm-green">{formatPeso(p.retail_per_kg)}/kg</span>
                        <span className={cn('block text-[10px] font-semibold', out ? 'text-farm-danger' : 'text-farm-muted')}>{out ? 'Out of stock' : `${round2(avail)} kg left`}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </Card>

          {selected ? (
            <Card className="animate-fade-in border-farm-green">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h4 className="flex items-center gap-2 text-lg font-bold text-farm-green"><Scale className="h-5 w-5" aria-hidden /> Inputting Weight for: <span className="underline">{selected.name}</span></h4>
                  <p className="text-xs text-farm-muted">Active price: {formatPeso(selected.retail_per_kg)} per kg</p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-bold uppercase text-farm-muted" htmlFor="pos-weight">Weight (in kg)</label>
                  <input
                    id="pos-weight"
                    value={weight}
                    onChange={(e) => setWeight(e.target.value.replace(/[^0-9.]/g, ''))}
                    inputMode="decimal"
                    placeholder="Enter or touch weight…"
                    className="tabular min-h-16 w-full rounded-xl border border-farm-green bg-farm-bg px-4 text-right text-2xl font-black outline-none focus:ring-2 focus:ring-farm-green-500"
                  />
                  <div className="mt-3 flex items-center justify-between rounded-lg bg-farm-accent-soft p-3 text-xs text-farm-green">
                    <span>Line total:</span>
                    <span className="tabular text-sm font-black">{formatPeso(lineTotal(parseFloat(weight) || 0, selected.retail_per_kg))}</span>
                  </div>
                  <Button onClick={addToSlip} className="mt-4 w-full">ADD TO ACTIVE SLIP</Button>
                  <Button variant="ghost" onClick={() => setSelected(null)} className="mt-2 w-full">Cancel</Button>
                </div>
                <Numpad value={weight} onChange={setWeight} />
              </div>
            </Card>
          ) : null}
        </div>

        {/* RIGHT — Active Slip Counter → checkout → slip */}
        <div className="w-full xl:w-96">
          {pane === 'slip' ? (
            <Card className="flex min-h-[420px] flex-col justify-between">
              <div>
                <h3 className="mb-4 flex items-center justify-between border-b border-farm-accent-soft pb-2 text-lg font-bold text-farm-green">
                  <span>Active Slip Counter</span>
                  <span className="text-xs font-normal text-farm-muted">items: {basket.length}</span>
                </h3>
                {basket.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center text-farm-muted">
                    <AlertCircle className="mb-2 h-10 w-10 text-farm-accent" aria-hidden />
                    <span className="text-sm">Empty slip. Choose a crop to get started.</span>
                  </div>
                ) : (
                  <ul className="max-h-80 space-y-2.5 overflow-auto pr-1">
                    {basket.map((l, i) => (
                      <li key={i} className="flex min-h-14 items-center justify-between rounded-xl border border-farm-accent-soft bg-farm-bg px-3 text-xs">
                        <span>
                          <span className="block text-base font-bold text-farm-green">{l.name}</span>
                          <span className="text-[11px] text-farm-muted">{l.weight_kg} kg × {formatPeso(l.unit_price)}/kg</span>
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="tabular text-base font-bold text-farm-ink">{formatPeso(lineTotal(l.weight_kg, l.unit_price))}</span>
                          <button onClick={() => setBasket(basket.filter((_, idx) => idx !== i))} className="rounded p-2 text-farm-danger transition hover:bg-red-50" aria-label={`Remove ${l.name}`}>
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="mt-4 space-y-4 border-t border-farm-accent-soft pt-4">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-semibold text-farm-muted">Total Due:</span>
                  <span className="tabular text-3xl font-black text-farm-green">{formatPeso(total)}</span>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" disabled={basket.length === 0} onClick={() => setBasket([])} aria-label="Clear slip"><Trash2 className="h-4 w-4" aria-hidden /></Button>
                  <Button className="flex-1" disabled={basket.length === 0} onClick={() => {setCash(''); setPane('checkout');}}>PROCEED CHECKOUT</Button>
                </div>
              </div>
            </Card>
          ) : pane === 'checkout' ? (
            <Card className="animate-fade-in">
              <h3 className="mb-3 flex items-center gap-2 text-lg font-bold text-farm-green"><Banknote className="h-5 w-5" aria-hidden /> Direct Cash Clearance</h3>
              <div className="mb-3 rounded-xl border border-farm-accent-soft bg-farm-bg p-3 text-right">
                <span className="block text-xs font-bold uppercase text-farm-muted">Grand Total Due</span>
                <span className="tabular text-3xl font-black text-farm-green">{formatPeso(total)}</span>
              </div>
              <label className="mb-1.5 block text-xs font-bold uppercase text-farm-muted" htmlFor="pos-cash">Cash received (₱)</label>
              <input
                id="pos-cash"
                value={cash}
                onChange={(e) => setCash(e.target.value.replace(/[^0-9.]/g, ''))}
                inputMode="decimal"
                placeholder="0.00"
                className="tabular mb-3 min-h-16 w-full rounded-xl border border-farm-green px-4 text-right text-3xl font-black focus:outline-none focus:ring-2 focus:ring-farm-green-500"
              />
              <div className="mb-3 flex items-center justify-between px-1 text-xs text-farm-muted">
                <span>Change due back:</span>
                <span className={cn('tabular text-sm font-extrabold', cashNum >= total ? 'text-farm-green' : 'text-farm-danger')}>{formatPeso(Math.max(0, round2(cashNum - total)))}</span>
              </div>
              <Numpad value={cash} onChange={setCash} />
              <div className="mt-4 flex gap-2">
                <Button variant="secondary" onClick={() => setPane('slip')} disabled={busy}>Cancel</Button>
                <Button className="flex-1" onClick={() => void commitSale()} disabled={busy || cashNum < total || basket.length === 0}>
                  {busy ? 'RECORDING…' : 'RECORD TRANSACTION'}
                </Button>
              </div>
            </Card>
          ) : (
            <Card className="animate-fade-in">
              <div className="mx-auto max-w-sm font-mono text-sm" id="pos-slip">
                <p className="text-center text-base font-bold uppercase tracking-wide text-farm-green">Pick Ur Veggie Farm</p>
                <p className="mb-3 text-center text-[10px] italic text-farm-muted">"Fresh from our harvest poly-tunnels to you"</p>
                <p className="text-[10px] text-farm-muted">{new Date(lastSale?.invoice.created_at ?? Date.now()).toLocaleString('en-PH')}</p>
                <p className="mb-2 text-[11px] font-bold text-farm-ink">
                  Slip #{lastSale?.invoice.invoice_number != null ? String(lastSale.invoice.invoice_number).padStart(5, '0') : 'PENDING SYNC'}
                  {lastSale?.provisional ? ' · saved offline' : ''}
                </p>
                <div className="space-y-1.5 border-y border-dashed border-farm-accent py-2">
                  {lastSale?.invoice.lines.map((l, i) => (
                    <div key={i} className="flex justify-between gap-4">
                      <span className="leading-tight">{l.name}<span className="block text-[10px] text-farm-muted">{l.weight_kg} kg × {formatPeso(l.unit_price)}/kg</span></span>
                      <span className="tabular font-bold">{formatPeso(l.line_total)}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-2 space-y-1">
                  <div className="flex justify-between text-sm font-black"><span>TOTAL</span><span className="tabular">{formatPeso(lastSale?.invoice.total ?? 0)}</span></div>
                  <div className="flex justify-between text-[11px]"><span>Cash Paid</span><span className="tabular">{formatPeso(lastSale?.invoice.tender_cash ?? 0)}</span></div>
                  <div className="flex justify-between text-[11px] font-bold"><span>Change Given</span><span className="tabular">{formatPeso(lastSale?.invoice.change_amount ?? 0)}</span></div>
                </div>
                <p className="mt-4 border-t border-dashed border-farm-accent pt-2 text-center text-[10px] text-farm-muted">This is a sales record slip, not an official receipt.<br />Salamat po for pickin' ur organic veggies!</p>
              </div>
              <div className="mt-5 flex gap-2">
                <Button variant="secondary" onClick={() => window.print()}><Printer size={18} aria-hidden /> Print Slip</Button>
                <Button className="flex-1" onClick={() => setPane('slip')}>New Sale</Button>
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* Historical Sales Journal (prototype: below the terminal) */}
      <Card>
        <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h3 className="text-lg font-bold text-farm-green">Historical Sales Journal</h3>
            <p className="text-xs text-farm-muted">Failsafe registry tracking retail weigh-outs on this device.</p>
          </div>
        </div>
        <div className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-farm-accent-soft bg-farm-bg/50 p-4 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="j-date">Filter Date</label>
            <input id="j-date" type="date" value={journalDate} onChange={(e) => setJournalDate(e.target.value)} className="min-h-12 w-full rounded-lg border border-farm-accent-soft bg-white p-2 text-sm font-semibold" />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted">Sync Status</label>
            <SelectField value={journalStatus} onChange={setJournalStatus} options={[{value: 'all', label: 'All Statuses'}, {value: 'Paid', label: 'Paid (Synced)'}, {value: 'PendingSync', label: 'Pending Sync'}]} />
          </div>
          <div className="flex items-end">
            <Button variant="secondary" className="w-full" onClick={() => {setJournalDate(''); setJournalStatus('all');}}>Reset Filters</Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-farm-accent-soft text-left text-xs font-bold tracking-wider text-farm-muted">
                <th className="pb-3">Datetime</th>
                <th className="pb-3">Slip #</th>
                <th className="pb-3">Items</th>
                <th className="pb-3 text-right">Total</th>
                <th className="pb-3 text-right">Cash / Change</th>
                <th className="pb-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-farm-accent-soft text-sm">
              {(invoices ?? [])
                .filter((t) => (journalDate ? t.created_at.slice(0, 10) === journalDate : true))
                .filter((t) => (journalStatus === 'all' ? true : t.status === journalStatus))
                .map((t) => (
                  <tr key={t.id} className="hover:bg-farm-bg/40">
                    <td className="tabular py-3 text-xs">{new Date(t.created_at).toLocaleString('en-PH')}</td>
                    <td className="py-3 font-mono font-bold">{t.invoice_number != null ? `#${String(t.invoice_number).padStart(5, '0')}` : '—'}</td>
                    <td className="max-w-xs truncate py-3 text-xs text-farm-muted">{t.lines.map((l) => l.name).join(', ')}</td>
                    <td className="tabular py-3 text-right font-bold">{formatPeso(t.total)}</td>
                    <td className="tabular py-3 text-right text-xs">{formatPeso(t.tender_cash)} / {formatPeso(t.change_amount)}</td>
                    <td className="py-3 text-center">
                      <span className={cn('rounded px-2 py-0.5 text-xs font-bold', t.status === 'Paid' ? 'bg-farm-accent-soft text-farm-green' : 'bg-amber-100 text-amber-800')}>
                        {t.status === 'Paid' ? 'Paid' : 'Pending Sync'}
                      </span>
                    </td>
                  </tr>
                ))}
              {(invoices ?? []).length === 0 ? (
                <tr><td colSpan={6} className="py-8 text-center text-sm italic text-farm-muted">No sales recorded on this device yet.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
