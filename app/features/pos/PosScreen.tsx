// Weigh Point-of-Sale (P2-M2B-2/M2C-b) — cashier terminal styled to the AI Studio prototype (visual authority).
// LEFT = crop cashier grid + weigh pad; RIGHT = Active Slip Counter → checkout (Direct Cash | Pre-order) →
// printable slip, plus a settle pane for Mark-Paid. Below: Historical Sales Journal with Mark Paid / Void.
// A cash-session strip (22.09) sits above the terminal. All writes go through posApi (server authority; B5 offline).
import {useCallback, useEffect, useMemo, useState} from 'react';
import {useLiveQuery} from 'dexie-react-hooks';
import {AlertCircle, Banknote, CloudOff, Lock, Printer, Scale, ShoppingCart, Sprout, Trash2, Wallet} from 'lucide-react';
import {offlineDB} from '../../core/offline/db';
import {usePermissions} from '../../core/permissions/permissions';
import {useSync} from '../../core/offline/sync';
import {Button, Card, PageHeader, cn} from '../../components/ui';
import {EmptyState, Skeleton, useToast} from '../../components/feedback';
import {SelectField} from '../../components/overlay';
import {Numpad} from './Numpad';
import {posApi, type SaleLineInput, type SaleResult} from './api';
import {formatPeso, lineTotal, round2} from './money';
import type {FinishedGood, PosCashSession, PosInvoice, Product} from '../../types/db';

type RightPane = 'slip' | 'checkout' | 'receipt' | 'settle';
type SaleKind = 'paid' | 'preorder';

export default function PosScreen() {
  const {companyId, has} = usePermissions();
  const {online, triggerSync} = useSync();
  const {notify} = useToast();
  const canSell = has('pos.sell');
  const canSettle = has('pos.settle');
  const canVoid = has('pos.void');
  const canSession = has('cash.session');

  const branches = useLiveQuery(async () => (companyId ? offlineDB.branches.where('company_id').equals(companyId).filter((b) => b.status === 'Active').toArray() : []), [companyId]);
  const [branchId, setBranchId] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!branchId && branches && branches.length > 0) setBranchId(branches[0]!.id);
  }, [branches, branchId]);

  const [products, setProducts] = useState<Product[] | null>(null);
  const [stock, setStock] = useState<FinishedGood[]>([]);
  const [session, setSession] = useState<PosCashSession | null>(null);
  const reload = useCallback(() => {
    if (!companyId || !branchId) return;
    posApi.fetchProducts(companyId).then(setProducts).catch(() => setProducts([]));
    posApi.fetchStock(companyId, branchId).then(setStock).catch(() => setStock([]));
    posApi.currentSession(branchId).then(setSession).catch(() => setSession(null));
  }, [companyId, branchId]);
  useEffect(reload, [reload]);

  const [selected, setSelected] = useState<Product | null>(null);
  const [weight, setWeight] = useState('');
  const [basket, setBasket] = useState<SaleLineInput[]>([]);
  const [pane, setPane] = useState<RightPane>('slip');
  const [cash, setCash] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastSale, setLastSale] = useState<SaleResult | null>(null);

  // checkout classification (prototype: Direct Cash Clearance | Pre-order Unpaid Delivery)
  const [saleKind, setSaleKind] = useState<SaleKind>('paid');
  const [preDiscount, setPreDiscount] = useState(true);
  const [preDelivery, setPreDelivery] = useState(false);
  const [deliveryFee, setDeliveryFee] = useState('');
  const [note, setNote] = useState('');

  // settle / void targets
  const [settleTarget, setSettleTarget] = useState<PosInvoice | null>(null);
  const [voidTarget, setVoidTarget] = useState<PosInvoice | null>(null);
  const [voidReason, setVoidReason] = useState('');

  // cash session strip inputs
  const [floatInput, setFloatInput] = useState('');
  const [countedInput, setCountedInput] = useState('');
  const [varianceReason, setVarianceReason] = useState('');

  // journal filters
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

  const subtotal = round2(basket.reduce((s, l) => s + lineTotal(l.weight_kg, l.unit_price), 0));
  const feeNum = preDelivery ? (parseFloat(deliveryFee) || 0) : 0;
  const discountNum = saleKind === 'preorder' && preDiscount ? round2(subtotal * 0.1) : 0;
  const grandTotal = saleKind === 'preorder' ? round2(subtotal - discountNum + feeNum) : subtotal;
  const cashNum = parseFloat(cash) || 0;

  async function commitSale() {
    if (busy || !companyId || !branchId || basket.length === 0) return;
    setBusy(true); // O4 double-submit guard
    try {
      const result = await posApi.recordSale(companyId, branchId, basket, saleKind === 'paid' ? cashNum : 0, {
        kind: saleKind,
        discountRate: saleKind === 'preorder' && preDiscount ? 0.1 : 0,
        deliveryFee: feeNum,
        note: note.trim() || undefined,
      });
      setLastSale(result);
      setBasket([]); setCash(''); setNote(''); setDeliveryFee(''); setPreDelivery(false); setPreDiscount(true); setSaleKind('paid');
      setPane('receipt');
      if (result.provisional) triggerSync();
      reload();
      notify(result.provisional ? 'Sale saved offline — will sync' : `Recorded — slip #${result.invoice.invoice_number ?? '—'}`);
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Sale failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function commitSettle() {
    if (busy || !companyId || !settleTarget) return;
    setBusy(true);
    try {
      const change = await posApi.settle(companyId, settleTarget, cashNum);
      notify(`Settled — change ${formatPeso(change)}`);
      setSettleTarget(null); setCash(''); setPane('slip');
      reload();
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Settlement failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function commitVoid() {
    if (busy || !companyId || !voidTarget) return;
    setBusy(true);
    try {
      await posApi.voidSale(companyId, voidTarget, voidReason);
      notify(`Slip #${voidTarget.invoice_number ?? '—'} voided`);
      setVoidTarget(null); setVoidReason('');
      reload();
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Void failed', 'error');
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

      {/* Cash-session strip (22.09) */}
      {canSession ? (
        <Card className="flex flex-wrap items-center gap-3 py-3">
          <Wallet className="h-5 w-5 text-farm-green" aria-hidden />
          {session ? (
            <>
              <span className="text-sm font-bold text-farm-green">Drawer open</span>
              <span className="text-xs text-farm-muted">since {new Date(session.opened_at).toLocaleTimeString('en-PH')} · float {formatPeso(session.opening_cash)}</span>
              <span className="ml-auto flex flex-wrap items-center gap-2">
                <input value={countedInput} onChange={(e) => setCountedInput(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder="Counted cash…" aria-label="Counted cash" className="tabular min-h-12 w-36 rounded-lg border border-farm-accent px-3 text-right text-sm font-bold" />
                <input value={varianceReason} onChange={(e) => setVarianceReason(e.target.value)} placeholder="Variance reason (if any)" aria-label="Variance reason" className="min-h-12 w-52 rounded-lg border border-farm-accent-soft px-3 text-sm" />
                <Button
                  variant="secondary"
                  disabled={busy || countedInput === ''}
                  onClick={async () => {
                    try {
                      const v = await posApi.closeSession(session, parseFloat(countedInput) || 0, varianceReason.trim() || undefined);
                      notify(v === 0 ? 'Drawer closed — no variance' : `Drawer closed — variance ${formatPeso(v)}`);
                      setCountedInput(''); setVarianceReason(''); reload();
                    } catch (e) { notify(e instanceof Error ? e.message : 'Close failed', 'error'); }
                  }}
                >
                  Close & Count
                </Button>
              </span>
            </>
          ) : (
            <>
              <span className="text-sm font-bold text-farm-muted">Drawer closed</span>
              <span className="ml-auto flex items-center gap-2">
                <input value={floatInput} onChange={(e) => setFloatInput(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder="Opening cash…" aria-label="Opening cash" className="tabular min-h-12 w-36 rounded-lg border border-farm-accent px-3 text-right text-sm font-bold" />
                <Button
                  variant="secondary"
                  disabled={busy || !branchId || floatInput === ''}
                  onClick={async () => {
                    try {
                      await posApi.openSession(branchId!, parseFloat(floatInput) || 0);
                      notify('Drawer opened'); setFloatInput(''); reload();
                    } catch (e) { notify(e instanceof Error ? e.message : 'Open failed', 'error'); }
                  }}
                >
                  Open Drawer
                </Button>
              </span>
            </>
          )}
        </Card>
      ) : null}

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

        {/* RIGHT — slip → checkout/settle → receipt */}
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
                  <span className="tabular text-3xl font-black text-farm-green">{formatPeso(subtotal)}</span>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" disabled={basket.length === 0} onClick={() => setBasket([])} aria-label="Clear slip"><Trash2 className="h-4 w-4" aria-hidden /></Button>
                  <Button className="flex-1" disabled={basket.length === 0} onClick={() => {setCash(''); setSaleKind('paid'); setPane('checkout');}}>PROCEED CHECKOUT</Button>
                </div>
              </div>
            </Card>
          ) : pane === 'checkout' ? (
            <Card className="animate-fade-in">
              <h3 className="mb-3 text-center text-lg font-bold text-farm-green">Process Farm Transaction</h3>
              {/* classification tabs (prototype) */}
              <div className="mb-4 grid grid-cols-2 gap-2 rounded-xl border border-farm-accent-soft bg-farm-bg p-1.5">
                <button onClick={() => setSaleKind('paid')} className={cn('min-h-12 rounded-lg px-2 text-sm font-bold transition', saleKind === 'paid' ? 'bg-farm-green text-white' : 'text-farm-muted hover:text-farm-green')}>Direct Cash Clearance</button>
                <button onClick={() => setSaleKind('preorder')} className={cn('min-h-12 rounded-lg px-2 text-sm font-bold transition', saleKind === 'preorder' ? 'bg-farm-green text-white' : 'text-farm-muted hover:text-farm-green')}>Pre-order (Unpaid)</button>
              </div>
              <div className="mb-3 rounded-xl border border-farm-accent-soft bg-farm-bg p-3 text-right">
                <span className="block text-xs font-bold uppercase text-farm-muted">Grand Total Due</span>
                <span className="tabular text-3xl font-black text-farm-green">{formatPeso(grandTotal)}</span>
              </div>

              {saleKind === 'paid' ? (
                <>
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
                    <span className={cn('tabular text-sm font-extrabold', cashNum >= grandTotal ? 'text-farm-green' : 'text-farm-danger')}>{formatPeso(Math.max(0, round2(cashNum - grandTotal)))}</span>
                  </div>
                  <Numpad value={cash} onChange={setCash} />
                </>
              ) : (
                <div className="space-y-3">
                  <div className="rounded-xl border border-farm-accent-soft bg-farm-accent-soft/40 p-3 text-sm">
                    <label className="flex min-h-10 cursor-pointer items-center justify-between font-bold text-farm-ink">
                      <span className="flex items-center gap-2"><input type="checkbox" checked={preDiscount} onChange={(e) => setPreDiscount(e.target.checked)} className="h-4 w-4 accent-farm-green" /> Include 10% Discount</span>
                      {preDiscount ? <span className="tabular text-farm-green">− {formatPeso(discountNum)}</span> : null}
                    </label>
                    <label className="flex min-h-10 cursor-pointer items-center justify-between font-bold text-farm-ink">
                      <span className="flex items-center gap-2"><input type="checkbox" checked={preDelivery} onChange={(e) => {setPreDelivery(e.target.checked); if (!e.target.checked) setDeliveryFee('');}} className="h-4 w-4 accent-farm-green" /> Add Delivery Fee</span>
                      {preDelivery ? <span className="tabular text-farm-green">+ {formatPeso(feeNum)}</span> : null}
                    </label>
                    {preDelivery ? (
                      <input value={deliveryFee} onChange={(e) => setDeliveryFee(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder="Fee amount (₱)" aria-label="Delivery fee" className="tabular mt-1 min-h-12 w-full rounded-lg border border-farm-accent px-3 text-right text-sm font-bold" />
                    ) : null}
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-bold uppercase text-farm-muted" htmlFor="pos-note">Delivery note / vendor</label>
                    <textarea id="pos-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Deliver to Aling Sandra at Public Market at 2 PM" className="h-20 w-full rounded-xl border border-farm-accent-soft bg-farm-bg/50 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-farm-green-500" />
                  </div>
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">No cash is taken now — the pre-order becomes a receivable until Marked Paid.</p>
                </div>
              )}

              <div className="mt-4 flex gap-2">
                <Button variant="secondary" onClick={() => setPane('slip')} disabled={busy}>Cancel</Button>
                <Button className="flex-1" onClick={() => void commitSale()} disabled={busy || basket.length === 0 || (saleKind === 'paid' && cashNum < grandTotal)}>
                  {busy ? 'RECORDING…' : 'RECORD TRANSACTION'}
                </Button>
              </div>
            </Card>
          ) : pane === 'settle' && settleTarget ? (
            <Card className="animate-fade-in">
              <h3 className="mb-3 flex items-center gap-2 text-lg font-bold text-farm-green"><Banknote className="h-5 w-5" aria-hidden /> Offset Unpaid Pre-order</h3>
              <p className="mb-3 text-xs text-farm-muted">Slip #{settleTarget.invoice_number != null ? String(settleTarget.invoice_number).padStart(5, '0') : '—'} · {settleTarget.note ?? 'no note'}</p>
              <div className="mb-3 rounded-xl border border-farm-accent-soft bg-farm-bg p-3 text-right">
                <span className="block text-xs font-bold uppercase text-farm-muted">Amount outstanding</span>
                <span className="tabular text-3xl font-black text-farm-green">{formatPeso(settleTarget.total)}</span>
              </div>
              <input
                value={cash}
                onChange={(e) => setCash(e.target.value.replace(/[^0-9.]/g, ''))}
                inputMode="decimal"
                placeholder="Cash paid (₱)"
                aria-label="Cash paid"
                className="tabular mb-3 min-h-16 w-full rounded-xl border border-farm-green px-4 text-right text-3xl font-black focus:outline-none focus:ring-2 focus:ring-farm-green-500"
              />
              <div className="mb-3 flex items-center justify-between px-1 text-xs text-farm-muted">
                <span>Change given:</span>
                <span className={cn('tabular text-sm font-extrabold', cashNum >= settleTarget.total ? 'text-farm-green' : 'text-farm-danger')}>{formatPeso(Math.max(0, round2(cashNum - settleTarget.total)))}</span>
              </div>
              <Numpad value={cash} onChange={setCash} />
              <div className="mt-4 flex gap-2">
                <Button variant="secondary" onClick={() => {setSettleTarget(null); setPane('slip');}} disabled={busy}>Close</Button>
                <Button className="flex-1" onClick={() => void commitSettle()} disabled={busy || cashNum < settleTarget.total}>
                  {busy ? 'SETTLING…' : 'CONFIRM RECONCILIATION'}
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
                  {lastSale && lastSale.invoice.discount > 0 ? (
                    <div className="flex justify-between text-[11px] text-farm-green"><span>10% Discount</span><span className="tabular">−{formatPeso(lastSale.invoice.discount)}</span></div>
                  ) : null}
                  {lastSale && lastSale.invoice.delivery_fee > 0 ? (
                    <div className="flex justify-between text-[11px]"><span>Delivery Fee</span><span className="tabular">+{formatPeso(lastSale.invoice.delivery_fee)}</span></div>
                  ) : null}
                  <div className="flex justify-between text-sm font-black"><span>TOTAL</span><span className="tabular">{formatPeso(lastSale?.invoice.total ?? 0)}</span></div>
                  {lastSale?.invoice.status === 'Unpaid' ? (
                    <p className="mt-1 border border-amber-200 bg-amber-50 p-1.5 text-[10px] font-semibold italic text-amber-900">Pre-order delivery — cash collection pending.</p>
                  ) : (
                    <>
                      <div className="flex justify-between text-[11px]"><span>Cash Paid</span><span className="tabular">{formatPeso(lastSale?.invoice.tender_cash ?? 0)}</span></div>
                      <div className="flex justify-between text-[11px] font-bold"><span>Change Given</span><span className="tabular">{formatPeso(lastSale?.invoice.change_amount ?? 0)}</span></div>
                    </>
                  )}
                </div>
                {lastSale?.invoice.note ? <p className="mt-2 rounded bg-farm-bg p-1.5 text-[10px] font-bold text-farm-green">Note: {lastSale.invoice.note}</p> : null}
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

      {/* void confirmation panel */}
      {voidTarget ? (
        <Card className="animate-fade-in border-farm-danger">
          <h3 className="mb-2 text-lg font-bold text-farm-danger">Void slip #{voidTarget.invoice_number != null ? String(voidTarget.invoice_number).padStart(5, '0') : '—'}?</h3>
          <p className="mb-3 text-sm text-farm-muted">This appends reversing entries (stock returned, books reversed). It cannot be undone — history is preserved.</p>
          <div className="flex flex-wrap items-center gap-2">
            <input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="Reason (required)…" aria-label="Void reason" className="min-h-12 flex-1 rounded-lg border border-farm-accent px-3 text-sm" />
            <Button variant="secondary" onClick={() => {setVoidTarget(null); setVoidReason('');}} disabled={busy}>Cancel</Button>
            <Button variant="danger" onClick={() => void commitVoid()} disabled={busy || !voidReason.trim()}>{busy ? 'VOIDING…' : 'VOID SLIP'}</Button>
          </div>
        </Card>
      ) : null}

      {/* Historical Sales Journal (prototype: below the terminal) */}
      <Card>
        <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h3 className="text-lg font-bold text-farm-green">Historical Sales Journal</h3>
            <p className="text-xs text-farm-muted">Failsafe registry tracking retail weigh-outs and pending wholesale pre-orders.</p>
          </div>
        </div>
        <div className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-farm-accent-soft bg-farm-bg/50 p-4 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="j-date">Filter Date</label>
            <input id="j-date" type="date" value={journalDate} onChange={(e) => setJournalDate(e.target.value)} className="min-h-12 w-full rounded-lg border border-farm-accent-soft bg-white p-2 text-sm font-semibold" />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted">Status</label>
            <SelectField value={journalStatus} onChange={setJournalStatus} options={[{value: 'all', label: 'All Statuses'}, {value: 'Paid', label: 'Paid (Cleared)'}, {value: 'Unpaid', label: 'Pre-orders (Unpaid)'}, {value: 'Voided', label: 'Voided'}, {value: 'PendingSync', label: 'Pending Sync'}]} />
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
                <th className="pb-3">Items / Note</th>
                <th className="pb-3 text-right">Total</th>
                <th className="pb-3 text-center">Status</th>
                <th className="pb-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-farm-accent-soft text-sm">
              {(invoices ?? [])
                .filter((t) => (journalDate ? t.created_at.slice(0, 10) === journalDate : true))
                .filter((t) => (journalStatus === 'all' ? true : t.status === journalStatus))
                .map((t) => (
                  <tr key={t.id} className={cn('hover:bg-farm-bg/40', t.status === 'Voided' && 'text-farm-muted line-through')}>
                    <td className="tabular py-3 text-xs">{new Date(t.created_at).toLocaleString('en-PH')}</td>
                    <td className="py-3 font-mono font-bold">{t.invoice_number != null ? `#${String(t.invoice_number).padStart(5, '0')}` : '—'}</td>
                    <td className="max-w-xs truncate py-3 text-xs text-farm-muted" title={t.note ?? undefined}>{t.note ? <span className="italic">{t.note}</span> : t.lines.map((l) => l.name).join(', ')}</td>
                    <td className="tabular py-3 text-right font-bold">{formatPeso(t.total)}</td>
                    <td className="py-3 text-center">
                      <span className={cn('rounded px-2 py-0.5 text-xs font-bold no-underline',
                        t.status === 'Paid' ? 'bg-farm-accent-soft text-farm-green'
                        : t.status === 'Unpaid' ? 'bg-amber-100 text-amber-800'
                        : t.status === 'Voided' ? 'bg-red-100 text-farm-danger'
                        : 'bg-blue-100 text-blue-900')}>
                        {t.status === 'Unpaid' ? 'Pre-order / Unpaid' : t.status === 'PendingSync' ? 'Pending Sync' : t.status.toUpperCase() === 'VOIDED' ? 'VOID' : t.status}
                      </span>
                    </td>
                    <td className="py-3 text-right">
                      <span className="flex justify-end gap-1.5">
                        {t.status === 'Unpaid' && canSettle ? (
                          <button onClick={() => {setSettleTarget(t); setCash(''); setPane('settle');}} className="rounded border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-800 hover:bg-amber-100">Mark Paid</button>
                        ) : null}
                        {t.status !== 'Voided' && t.status !== 'PendingSync' && canVoid ? (
                          <button onClick={() => {setVoidTarget(t); setVoidReason('');}} className="rounded px-2 py-1 text-xs font-semibold text-farm-danger hover:bg-red-50">Void</button>
                        ) : null}
                        {t.status !== 'Voided' && !canVoid && !canSettle ? <Lock className="h-3.5 w-3.5 text-farm-accent" aria-hidden /> : null}
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
