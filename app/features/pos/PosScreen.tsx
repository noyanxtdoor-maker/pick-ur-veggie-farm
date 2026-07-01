// Weigh Point-of-Sale (P2-M2B-2) — the cashier terminal from the AI Studio prototype, on the V3 shell.
// Two-pane landscape: LEFT = product grid + weigh pad; RIGHT = slip → checkout → receipt (pane swap, no modals —
// faster for gloved tablet use). Sale commits via posApi.recordSale (server price authority; offline-queued per B5).
import {useCallback, useEffect, useMemo, useState} from 'react';
import {useLiveQuery} from 'dexie-react-hooks';
import {Banknote, CloudOff, Printer, Scale, ShoppingCart, Sprout, Trash2} from 'lucide-react';
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

  // available per product = stock minus what the current basket already claims (prevents in-basket oversell)
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
    // FIFO: earliest batch with enough remaining availability (single-batch line; splits are M2C+).
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
        <PageHeader title="Weigh POS" />
        <Card><EmptyState title="POS access needed" hint="Your role does not include the pos.sell permission. Ask a manager to grant it." /></Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Weigh POS"
        subtitle="Tap a vegetable, weigh it, add to the slip"
        action={
          <div className="w-56">
            <SelectField value={branchId} onChange={(v) => {setBranchId(v); setBasket([]);}} placeholder="Branch" options={(branches ?? []).map((b) => ({value: b.id, label: b.name}))} />
          </div>
        }
      />
      {!online ? (
        <p className="mb-4 flex items-center gap-2 rounded-xl bg-amber-100 px-4 py-2 text-base font-medium text-amber-900"><CloudOff size={18} aria-hidden /> Offline — sales are saved on this device and sync automatically.</p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        {/* LEFT — product grid + weigh pad */}
        <div className="space-y-5">
          <Card>
            <h2 className="mb-3 flex items-center gap-2 text-xl font-bold"><Sprout className="text-emerald-700" aria-hidden /> Vegetable grid</h2>
            {products === null ? (
              <Skeleton rows={3} />
            ) : products.length === 0 ? (
              <EmptyState title="No products yet" hint="Add vegetables and prices to the price book first." />
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                {products.map((p) => {
                  const avail = availableFor(p.id);
                  const out = avail <= 0;
                  return (
                    <button
                      key={p.id}
                      onClick={() => {setSelected(p); setWeight('');}}
                      disabled={out}
                      className={cn(
                        'flex min-h-28 flex-col items-center justify-center gap-1 rounded-2xl border-2 p-3 text-center transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600',
                        selected?.id === p.id ? 'border-emerald-600 bg-emerald-50' : 'border-slate-200 bg-white hover:border-emerald-400',
                        out && 'cursor-not-allowed opacity-40',
                      )}
                    >
                      <span className="text-lg font-bold leading-tight text-slate-900">{p.name}</span>
                      <span className="text-base font-extrabold text-emerald-800">{formatPeso(p.retail_per_kg)}/kg</span>
                      <span className={cn('text-sm font-medium', out ? 'text-red-600' : 'text-slate-500')}>{out ? 'Out of stock' : `${round2(avail)} kg left`}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </Card>

          {selected ? (
            <Card className="border-2 border-emerald-500">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-xl font-bold"><Scale className="text-emerald-700" aria-hidden /> Weigh: {selected.name}</h3>
                <span className="text-base text-slate-500">{formatPeso(selected.retail_per_kg)}/kg</span>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="flex flex-col gap-3">
                  <input
                    value={weight}
                    onChange={(e) => setWeight(e.target.value.replace(/[^0-9.]/g, ''))}
                    inputMode="decimal"
                    placeholder="0.000"
                    aria-label="Weight in kilograms"
                    className="min-h-16 w-full rounded-xl border border-emerald-600 bg-emerald-50/40 px-4 text-right text-3xl font-black text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                  <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 text-lg">
                    <span className="text-slate-600">Line total</span>
                    <span className="font-black text-emerald-800">{formatPeso(lineTotal(parseFloat(weight) || 0, selected.retail_per_kg))}</span>
                  </div>
                  <Button onClick={addToSlip} className="w-full">Add to slip</Button>
                  <Button variant="ghost" onClick={() => setSelected(null)}>Cancel</Button>
                </div>
                <Numpad value={weight} onChange={setWeight} />
              </div>
            </Card>
          ) : null}
        </div>

        {/* RIGHT — slip → checkout → receipt */}
        <div>
          {pane === 'slip' ? (
            <Card className="flex min-h-[420px] flex-col justify-between">
              <div>
                <h2 className="mb-3 flex items-center justify-between text-xl font-bold">
                  <span className="flex items-center gap-2"><ShoppingCart className="text-emerald-700" aria-hidden /> Active slip</span>
                  <span className="text-base font-normal text-slate-500">{basket.length} item{basket.length === 1 ? '' : 's'}</span>
                </h2>
                {basket.length === 0 ? (
                  <EmptyState title="Empty slip" hint="Choose a vegetable to get started." />
                ) : (
                  <ul className="max-h-80 space-y-2 overflow-auto">
                    {basket.map((l, i) => (
                      <li key={i} className="flex min-h-14 items-center justify-between rounded-xl bg-slate-50 px-3">
                        <span>
                          <span className="block text-lg font-semibold text-slate-800">{l.name}</span>
                          <span className="text-sm text-slate-500">{l.weight_kg} kg × {formatPeso(l.unit_price)}/kg</span>
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="text-lg font-bold">{formatPeso(lineTotal(l.weight_kg, l.unit_price))}</span>
                          <button onClick={() => setBasket(basket.filter((_, idx) => idx !== i))} className="rounded-lg p-2 text-red-600 hover:bg-red-50" aria-label={`Remove ${l.name}`}>
                            <Trash2 size={20} aria-hidden />
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="mt-4 border-t border-slate-200 pt-4">
                <div className="mb-3 flex items-baseline justify-between">
                  <span className="text-lg font-semibold text-slate-600">Total due</span>
                  <span className="text-4xl font-black text-emerald-800">{formatPeso(total)}</span>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" disabled={basket.length === 0} onClick={() => setBasket([])}>Clear</Button>
                  <Button className="flex-1" disabled={basket.length === 0} onClick={() => {setCash(''); setPane('checkout');}}>Checkout</Button>
                </div>
              </div>
            </Card>
          ) : pane === 'checkout' ? (
            <Card>
              <h2 className="mb-3 flex items-center gap-2 text-xl font-bold"><Banknote className="text-emerald-700" aria-hidden /> Cash payment</h2>
              <div className="mb-3 flex items-baseline justify-between rounded-xl bg-slate-50 px-4 py-3">
                <span className="text-lg text-slate-600">Total due</span>
                <span className="text-3xl font-black text-emerald-800">{formatPeso(total)}</span>
              </div>
              <input
                value={cash}
                onChange={(e) => setCash(e.target.value.replace(/[^0-9.]/g, ''))}
                inputMode="decimal"
                placeholder="Cash received"
                aria-label="Cash received"
                className="mb-3 min-h-16 w-full rounded-xl border border-emerald-600 px-4 text-right text-3xl font-black focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
              <div className="mb-3 flex items-center justify-between px-1 text-lg">
                <span className="text-slate-600">Change</span>
                <span className={cn('font-black', cashNum >= total ? 'text-emerald-800' : 'text-red-600')}>{formatPeso(Math.max(0, round2(cashNum - total)))}</span>
              </div>
              <Numpad value={cash} onChange={setCash} />
              <div className="mt-4 flex gap-2">
                <Button variant="secondary" onClick={() => setPane('slip')} disabled={busy}>Back</Button>
                <Button className="flex-1" onClick={() => void commitSale()} disabled={busy || cashNum < total || basket.length === 0}>
                  {busy ? 'Recording…' : 'Record sale'}
                </Button>
              </div>
            </Card>
          ) : (
            <Card>
              <div className="mx-auto max-w-sm font-mono text-sm" id="pos-slip">
                <p className="text-center text-base font-bold uppercase tracking-wide text-emerald-800">Pick Ur Veggie Farm</p>
                <p className="mb-3 text-center text-xs italic text-slate-500">Fresh from our harvest to you</p>
                <p className="text-xs text-slate-600">{new Date(lastSale?.invoice.created_at ?? Date.now()).toLocaleString('en-PH')}</p>
                <p className="mb-2 text-xs font-bold text-slate-800">
                  Slip #{lastSale?.invoice.invoice_number != null ? String(lastSale.invoice.invoice_number).padStart(5, '0') : 'PENDING SYNC'}
                  {lastSale?.provisional ? ' · saved offline' : ''}
                </p>
                <div className="space-y-1 border-y border-dashed border-slate-300 py-2">
                  {lastSale?.invoice.lines.map((l, i) => (
                    <div key={i} className="flex justify-between">
                      <span>{l.name}<span className="block text-xs text-slate-500">{l.weight_kg} kg × {formatPeso(l.unit_price)}/kg</span></span>
                      <span className="font-bold">{formatPeso(l.line_total)}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-2 space-y-1">
                  <div className="flex justify-between text-base font-black"><span>TOTAL</span><span>{formatPeso(lastSale?.invoice.total ?? 0)}</span></div>
                  <div className="flex justify-between text-xs"><span>Cash</span><span>{formatPeso(lastSale?.invoice.tender_cash ?? 0)}</span></div>
                  <div className="flex justify-between text-xs font-bold"><span>Change</span><span>{formatPeso(lastSale?.invoice.change_amount ?? 0)}</span></div>
                </div>
                <p className="mt-4 border-t border-dashed border-slate-300 pt-2 text-center text-xs text-slate-500">This is a sales slip, not an official receipt.<br />Salamat po!</p>
              </div>
              <div className="mt-5 flex gap-2">
                <Button variant="secondary" onClick={() => window.print()}><Printer size={20} aria-hidden /> Print</Button>
                <Button className="flex-1" onClick={() => setPane('slip')}>New sale</Button>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
