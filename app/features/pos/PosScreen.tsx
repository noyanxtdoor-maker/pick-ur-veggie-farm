// Weigh Point-of-Sale (P2-M2B-2/M2C-b) — cashier terminal styled to the AI Studio prototype (visual authority).
// LEFT = crop cashier grid + weigh pad; RIGHT = Active Slip Counter → checkout (Direct Cash | Pre-order) →
// printable slip, plus a settle pane for Mark-Paid. Below: Historical Sales Journal with Mark Paid / Void.
// Manual drawer at launch (owner 2026-07-04): no cash-session strip; the M2C session machinery stays in the DB.
import {useCallback, useEffect, useMemo, useState} from 'react';
import {useLiveQuery} from 'dexie-react-hooks';
import * as Dialog from '@radix-ui/react-dialog';
import {AlertCircle, Banknote, CloudOff, Download, Lock, Printer, Scale, Settings2, ShoppingCart, Sprout, Tag, Trash2, X} from 'lucide-react';
import {offlineDB} from '../../core/offline/db';
import {hydrateBranches, hydrateInvoices} from '../../core/offline/hydrate';
import {usePermissions} from '../../core/permissions/permissions';
import {useSync} from '../../core/offline/sync';
import {Button, Card, PageHeader, cn} from '../../components/ui';
import {EmptyState, Skeleton, useToast} from '../../components/feedback';
import {SelectField} from '../../components/overlay';
import {Numpad} from './Numpad';
import {posApi, type SaleLineInput, type SaleResult} from './api';
import {paymentsApi} from '../finance/api';
import {customersApi} from '../customers/api';
import {farmPerKg, formatPeso, lineTotal, round2} from './money';
import {usePref} from '../../core/prefs/prefs';
import type {Customer, FinancialAccount, FinishedGood, PosInvoice, Product, ProductRemovalRequest} from '../../types/db';

type RightPane = 'slip' | 'checkout' | 'receipt' | 'settle';
type SaleKind = 'paid' | 'preorder';

// ₱ of a slip line: bulk lines (weight null) carry their negotiated flat price in unit_price.
const lineAmount = (l: SaleLineInput) => (l.weight_kg === null ? l.unit_price : lineTotal(l.weight_kg, l.unit_price));

export default function PosScreen() {
  const {companyId, has} = usePermissions();
  const {online, triggerSync, refreshTick} = useSync();
  const {notify} = useToast();
  const canSell = has('pos.sell');
  const canSettle = has('pos.settle');
  const canManageProducts = has('product.manage');
  // P1O: employee/operator (product.remove only, default) can request a removal but not add/edit-price;
  // product.manage always supersedes (instant removal, no approval needed).
  const canRequestRemove = has('product.remove') || canManageProducts;
  const [receiptWidth] = usePref('receipt_width', '80'); // '58' | '80' — set in Settings, printed slip only

  useEffect(() => {if (companyId) hydrateBranches(companyId);}, [companyId]);
  // Found live (owner report, 2026-07-19): the Historical Sales Journal below reads offlineDB.posInvoices
  // directly — correct for a sale THIS device just made, but nothing ever pulled other devices' sales
  // into that cache, so the journal only ever showed "my own device's sales" despite the Dashboard right
  // above it correctly aggregating everyone's. Re-hydrates on mount and on every manual sync tap.
  useEffect(() => {if (companyId) hydrateInvoices(companyId);}, [companyId, refreshTick]);
  const branches = useLiveQuery(async () => (companyId ? offlineDB.branches.where('company_id').equals(companyId).filter((b) => b.status === 'Active').toArray() : []), [companyId]);
  const [branchId, setBranchId] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!branchId && branches && branches.length > 0) setBranchId(branches[0]!.id);
  }, [branches, branchId]);

  const [products, setProducts] = useState<Product[] | null>(null);
  const [stock, setStock] = useState<FinishedGood[]>([]);
  // P2-B2A payment-method picker: active bank/wallet accounts of this branch (empty list without
  // finance.account.read — the drawer is always available as the default).
  const [payAccounts, setPayAccounts] = useState<FinancialAccount[]>([]);
  const [payAccountId, setPayAccountId] = useState(''); // '' = cash drawer
  const [pendingRemovals, setPendingRemovals] = useState<ProductRemovalRequest[]>([]);
  // Owner directive (2026-07-19): the "Buy Stock vendor" (who we buy raw materials from, Vendors & AP)
  // is a different relationship from a Pre-order buyer (a wholesaler/retailer who buys FROM us to
  // resell) — the latter is exactly what the Customers & Credit module already tracks (AR, credit
  // limit, statement of account). Reusing it here, not building a second "vendor" concept.
  const canPickCustomer = has('customer.read');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [pickedCustomerId, setPickedCustomerId] = useState('');
  const reload = useCallback(() => {
    if (!companyId || !branchId) return;
    posApi.fetchProducts(companyId).then(setProducts).catch(() => setProducts([]));
    posApi.fetchStock(companyId, branchId).then(setStock).catch(() => setStock([]));
    paymentsApi.fetchPickerAccounts(companyId, branchId).then(setPayAccounts).catch(() => setPayAccounts([]));
    if (canManageProducts) posApi.fetchPendingRemovals().then(setPendingRemovals).catch(() => setPendingRemovals([]));
    if (canPickCustomer) customersApi.fetchCustomers(companyId).then((rows) => setCustomers(rows.filter((c) => c.status === 'Active'))).catch(() => setCustomers([]));
  }, [companyId, branchId, canManageProducts, canPickCustomer]);
  useEffect(reload, [reload, refreshTick]); // refreshTick: manual sync (top-bar wifi tap)

  const [selected, setSelected] = useState<Product | null>(null);
  const [weight, setWeight] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false); // prototype "Skip Weigh (Bulk Flat Price)"
  const [bulkPrice, setBulkPrice] = useState('');
  const [basket, setBasket] = useState<SaleLineInput[]>([]);
  const [pane, setPane] = useState<RightPane>('slip');
  const [cash, setCash] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastSale, setLastSale] = useState<SaleResult | null>(null);

  // checkout classification (prototype: Direct Cash Clearance | Pre-order Unpaid Delivery)
  const [saleKind, setSaleKind] = useState<SaleKind>('paid');
  // P2-M2G (owner 2026-07-18): the 10% discount toggle now applies to either tab, not preorder-only.
  // Defaults OFF (found during the role-sweep, 2026-07-18) — it was defaulting to true, meaning every
  // sale silently gave 10% off unless the cashier remembered to uncheck it. Discount should always be
  // an explicit per-sale opt-in, not something a distracted cashier gives away by accident.
  const [applyDiscount, setApplyDiscount] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [preDelivery, setPreDelivery] = useState(false);
  const [deliveryFee, setDeliveryFee] = useState('');
  const [note, setNote] = useState('');

  // settle / void targets
  const [settleTarget, setSettleTarget] = useState<PosInvoice | null>(null);
  const [voidTarget, setVoidTarget] = useState<PosInvoice | null>(null);
  const [voidReason, setVoidReason] = useState('');

  // journal filters (prototype: date + sale type + payment status)
  const [journalDate, setJournalDate] = useState('');
  const [journalType, setJournalType] = useState('all');
  const [journalStatus, setJournalStatus] = useState('all');

  // Crop Pricing Menu (prototype Catalog Manager; gated product.manage)
  const [pricingOpen, setPricingOpen] = useState(false);
  const [pmName, setPmName] = useState('');
  const [pmPrice, setPmPrice] = useState('');
  const [pmEditingId, setPmEditingId] = useState<string | null>(null);
  const [pmEditPrice, setPmEditPrice] = useState('');
  const [removeTarget, setRemoveTarget] = useState<Product | null>(null);
  const [removeReason, setRemoveReason] = useState('');
  const [rejectTarget, setRejectTarget] = useState<ProductRemovalRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const invoices = useLiveQuery(
    async () => (companyId ? offlineDB.posInvoices.where('company_id').equals(companyId).reverse().sortBy('created_at') : []),
    [companyId],
  );

  const claimed = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of basket) if (l.weight_kg !== null && l.finished_goods_batch_id !== null) m.set(l.finished_goods_batch_id, (m.get(l.finished_goods_batch_id) ?? 0) + l.weight_kg);
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
    // P2-M2F (owner directive 2026-07-17/18): produce isn't stock-counted — only Equipment/Materials are.
    // A matching batch is used for cost/stock tracking WHEN one happens to exist; its absence never blocks a sale.
    const batch = stock.find((f) => f.product_id === selected.id && f.available - (claimed.get(f.id) ?? 0) >= w);
    // charged price = FARM price (prototype DISCOUNT=0.10); retail snapshotted for the saved line; server recomputes
    setBasket([...basket, {product_id: selected.id, finished_goods_batch_id: batch?.id ?? null, name: selected.name, weight_kg: w, unit_price: farmPerKg(selected.retail_per_kg), retail_per_kg: selected.retail_per_kg}]);
    setSelected(null);
    setWeight('');
    setBulkOpen(false); setBulkPrice('');
  }

  // prototype "Skip Weigh": bulk wholesale line at a negotiated flat price (no weight, no stock claim)
  function addBulkToSlip() {
    if (!selected) return;
    const p = parseFloat(bulkPrice);
    if (isNaN(p) || p <= 0) return notify('Enter a flat wholesale price greater than ₱0.', 'error');
    setBasket([...basket, {product_id: selected.id, finished_goods_batch_id: null, name: `${selected.name} (Bulk Pre-order)`, weight_kg: null, unit_price: round2(p), retail_per_kg: null}]);
    setSelected(null);
    setBulkOpen(false); setBulkPrice(''); setWeight('');
  }

  const subtotal = round2(basket.reduce((s, l) => s + lineAmount(l), 0));
  const retailTotal = round2(basket.reduce((s, l) => s + (l.weight_kg !== null && l.retail_per_kg != null ? lineTotal(l.weight_kg, l.retail_per_kg) : lineAmount(l)), 0));
  const savedAmt = round2(retailTotal - subtotal); // prototype "Farm Discount Saved"
  // P2-M2G: delivery fee stays preorder-only (guarded here too, defensively, in case stale state from a
  // cancelled preorder checkout carries over after switching to Direct Cash — the server also rejects
  // this outright, but the client's own total preview must never show it for a 'paid' sale either).
  const feeNum = saleKind === 'preorder' && preDelivery ? (parseFloat(deliveryFee) || 0) : 0;
  const discountNum = applyDiscount ? round2(subtotal * 0.1) : 0;
  const grandTotal = round2(subtotal - discountNum + feeNum);
  const cashNum = parseFloat(cash) || 0;

  async function commitSale() {
    if (busy || !companyId || !branchId || basket.length === 0) return;
    setBusy(true); // O4 double-submit guard
    try {
      const result = await posApi.recordSale(companyId, branchId, basket, saleKind === 'paid' ? cashNum : 0, {
        kind: saleKind,
        discountRate: applyDiscount ? 0.1 : 0,
        deliveryFee: feeNum,
        note: note.trim() || undefined,
        financialAccountId: saleKind === 'paid' && payAccountId ? payAccountId : null,
        customerName: customerName.trim() || undefined,
      });
      // Attribution only (posts no journal, changes no amount — same non-money-mutating RPC the
      // Customers screen already uses) — links a sale (cash or pre-order) to a registered wholesale
      // buyer so their AR standing and statement of account pick it up, without touching the sale
      // RPC itself. Shared across both tabs (owner 2026-07-19) — a cash sale to a repeat buyer is
      // just as worth tracking as an unpaid one.
      if (pickedCustomerId && !result.provisional) {
        await customersApi.assignInvoice(companyId, result.invoice.id, pickedCustomerId).catch((e) => notify(e instanceof Error ? e.message : 'Could not link customer to this sale', 'error'));
      }
      setLastSale(result);
      setBasket([]); setCash(''); setNote(''); setCustomerName(''); setPickedCustomerId(''); setDeliveryFee(''); setPreDelivery(false); setApplyDiscount(true); setSaleKind('paid'); setPayAccountId('');
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
      const change = await posApi.settle(companyId, settleTarget, cashNum, payAccountId || null);
      notify(`Settled — change ${formatPeso(change)}`);
      setSettleTarget(null); setCash(''); setPane('slip'); setPayAccountId('');
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
      await posApi.requestVoid(companyId, voidTarget, voidReason);
      notify(`Void requested for slip #${voidTarget.invoice_number ?? '—'} — awaiting approval`);
      setVoidTarget(null); setVoidReason('');
      reload();
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Void request failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  // P1O: product.manage removes instantly; product.remove-only queues for approval. Same RPC either way —
  // the server decides which happens, the client just reports what it was told.
  async function submitRemove() {
    if (busy || !removeTarget) return;
    setBusy(true);
    try {
      await posApi.requestProductRemoval(removeTarget.id, removeReason);
      notify(canManageProducts ? `${removeTarget.name} removed` : `Removal request for ${removeTarget.name} sent for approval`);
      setRemoveTarget(null); setRemoveReason('');
      reload();
    } catch (e) { notify(e instanceof Error ? e.message : 'Removal failed', 'error'); } finally { setBusy(false); }
  }

  async function approveRemoval(r: ProductRemovalRequest) {
    setBusy(true);
    try {
      await posApi.approveProductRemoval(r.id);
      notify(`${r.product_name} removed`);
      reload();
    } catch (e) { notify(e instanceof Error ? e.message : 'Approval failed', 'error'); } finally { setBusy(false); }
  }

  async function submitReject() {
    if (busy || !rejectTarget) return;
    setBusy(true);
    try {
      await posApi.rejectProductRemoval(rejectTarget.id, rejectReason);
      notify(`Removal request for ${rejectTarget.product_name} rejected`);
      setRejectTarget(null); setRejectReason('');
      reload();
    } catch (e) { notify(e instanceof Error ? e.message : 'Rejection failed', 'error'); } finally { setBusy(false); }
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
          // Ported from Team B, owner 2026-07-16: branch picker is admin+ only (membership.read).
          // Operator/below only belong to ONE branch (RLS already limits offlineDB.branches to
          // their membership) and the default-branchId effect above pins them to branches[0].id —
          // the picker was redundant noise for them.
          has('membership.read') ? (
            <div className="w-56">
              <SelectField value={branchId} onChange={(v) => {setBranchId(v); setBasket([]);}} placeholder="Branch" options={(branches ?? []).map((b) => ({value: b.id, label: b.name}))} />
            </div>
          ) : null
        }
      />

      {/* Cash-session strip removed (owner 2026-07-04): launch flow is a manual drawer + manual weighing.
          The governed cash_sessions DB machinery (M2C, locked) stays intact for the future automated drawer. */}

      {!online ? (
        <p className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-base font-bold text-amber-900"><CloudOff size={18} aria-hidden /> POS Mode: Active Offline — sales are saved on this device and sync automatically.</p>
      ) : null}

      <div className="flex flex-col gap-6 xl:flex-row">
        {/* LEFT — crop cashier grid + weigh pad */}
        <div className="flex-1 space-y-6">
          <Card>
            <div className="mb-4 flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-lg font-bold text-farm-green"><ShoppingCart className="h-5 w-5" aria-hidden /> Vegetable Cashier Grid</h3>
              <span className="flex items-center gap-2">
                {canManageProducts || canRequestRemove ? (
                  <button onClick={() => {setPricingOpen(true); setPmName(''); setPmPrice(''); setPmEditingId(null);}} className="flex min-h-9 items-center gap-1 rounded-lg border border-farm-accent bg-farm-bg px-3 text-xs font-extrabold text-farm-green transition hover:bg-farm-accent-soft">
                    <Settings2 className="h-4 w-4" aria-hidden /> Crop Pricing Menu
                    {canManageProducts && pendingRemovals.length > 0 ? (
                      <span className="ml-1 rounded-full bg-farm-danger px-1.5 py-0.5 text-[10px] font-black text-white">{pendingRemovals.length}</span>
                    ) : null}
                  </button>
                ) : null}
                <span className="rounded-full bg-farm-accent-soft px-3 py-1 text-xs font-bold text-farm-green">{online ? 'POS Mode: Live' : 'POS Mode: Active Offline'}</span>
              </span>
            </div>
            {products === null ? (
              <Skeleton rows={3} />
            ) : products.length === 0 ? (
              <EmptyState title="No products yet" hint="Add vegetables and prices to the price book first." />
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                {products.map((p, idx) => {
                  // P2-M2F: no disabled/out-of-stock gate — produce isn't stock-counted (owner directive
                  // 2026-07-17/18). A "kg tracked" badge only appears when a batch happens to exist (e.g. a
                  // future harvest-tracking flow); its absence is normal, not a shortage.
                  const avail = availableFor(p.id);
                  return (
                    <button
                      key={p.id}
                      onClick={() => {setSelected(p); setWeight('');}}
                      className={cn(
                        'group relative flex h-40 flex-col items-center justify-center gap-2 rounded-2xl border p-3 text-center transition select-none',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-farm-green-500',
                        selected?.id === p.id ? 'border-farm-green bg-farm-accent-soft shadow-sm ring-2 ring-farm-green' : 'border-farm-accent-soft bg-farm-card hover:border-farm-green hover:bg-farm-bg/50',
                      )}
                    >
                      <span className="absolute right-2 top-2 rounded bg-farm-accent-soft px-1.5 py-0.5 font-mono text-[9px] font-black text-farm-green">#{101 + idx}</span>
                      <span className="flex h-14 w-14 items-center justify-center rounded-full border border-farm-accent-soft bg-farm-accent-soft text-farm-green transition-transform group-hover:scale-105">
                        <Sprout className="h-6 w-6" aria-hidden />
                      </span>
                      <span className="w-full">
                        <span className="block truncate text-sm font-extrabold leading-tight text-farm-ink">{p.name}</span>
                        <span className="mt-1 block text-xs font-black text-farm-green">{formatPeso(farmPerKg(p.retail_per_kg))}/kg</span>
                        <span className="block text-[10px] text-farm-muted line-through">Reg: {formatPeso(p.retail_per_kg)}</span>
                        {avail > 0 ? <span className="block text-[10px] font-semibold text-farm-muted">{round2(avail)} kg tracked</span> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </Card>

          {selected ? (
            <Card className="animate-fade-in border-farm-green">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="flex items-center gap-2 text-lg font-bold text-farm-green"><Scale className="h-5 w-5" aria-hidden /> Inputting Weight for: <span className="underline">{selected.name}</span></h4>
                  <p className="text-xs text-farm-muted">Active Price: {formatPeso(farmPerKg(selected.retail_per_kg))} farm price per kg</p>
                </div>
                <button onClick={() => {setBulkOpen(!bulkOpen); setBulkPrice('');}} className="min-h-9 rounded-lg border border-amber-200 bg-amber-50 px-3 text-xs font-bold text-amber-800 transition hover:bg-amber-100">
                  Skip Weigh (Bulk Flat Price)
                </button>
              </div>
              {bulkOpen ? (
                <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
                  <label className="mb-1.5 block text-xs font-bold uppercase text-amber-900" htmlFor="pos-bulk">Flat wholesale price (₱) for {selected.name} bulk batch</label>
                  <div className="flex gap-2">
                    <input
                      id="pos-bulk"
                      value={bulkPrice}
                      onChange={(e) => setBulkPrice(e.target.value.replace(/[^0-9.]/g, ''))}
                      inputMode="decimal"
                      placeholder="0.00"
                      className="tabular min-h-14 flex-1 rounded-xl border border-amber-300 bg-farm-card px-4 text-right text-2xl font-black outline-none focus:ring-2 focus:ring-amber-400"
                    />
                    <Button onClick={addBulkToSlip} disabled={!(parseFloat(bulkPrice) > 0)}>ADD BULK</Button>
                  </div>
                  <p className="mt-2 text-[11px] font-semibold text-amber-900">Negotiated lump price — no weighing; stock is adjusted separately.</p>
                </div>
              ) : null}
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
                    <span>Discounted Farm cost:</span>
                    <span className="tabular text-sm font-black">{formatPeso(lineTotal(parseFloat(weight) || 0, farmPerKg(selected.retail_per_kg)))}</span>
                  </div>
                  <Button onClick={addToSlip} className="mt-4 w-full">ADD TO ACTIVE SLIP</Button>
                  <Button variant="ghost" onClick={() => {setSelected(null); setBulkOpen(false);}} className="mt-2 w-full">Cancel</Button>
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
                          <span className="text-[11px] text-farm-muted">{l.weight_kg !== null ? `${l.weight_kg} kg × ${formatPeso(l.unit_price)}/kg` : 'Bulk pre-order price'}</span>
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="tabular text-base font-bold text-farm-ink">{formatPeso(lineAmount(l))}</span>
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
                {savedAmt > 0 ? (
                  <p className="flex items-center justify-end gap-1 text-xs font-bold text-emerald-700"><Tag className="h-3.5 w-3.5" aria-hidden /> Farm Discount Saved: {formatPeso(savedAmt)}</p>
                ) : null}
                <div className="flex gap-2">
                  <Button variant="secondary" disabled={basket.length === 0} onClick={() => setBasket([])} aria-label="Clear slip"><Trash2 className="h-4 w-4" aria-hidden /></Button>
                  <Button className="flex-1" disabled={basket.length === 0} onClick={() => {setCash(''); setSaleKind('paid'); setPayAccountId(''); setPane('checkout');}}>PROCEED CHECKOUT</Button>
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

              {/* P2-M2G: customer name + discount are shared across both tabs (owner 2026-07-18) */}
              <div className="mb-3">
                <label className="mb-1.5 block text-xs font-bold uppercase text-farm-muted" htmlFor="pos-customer">Customer name (optional)</label>
                <input id="pos-customer" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="e.g. Aling Sandra" className="min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm" />
              </div>
              {/* Owner directive (2026-07-19): the registered-buyer picker was Pre-order-only; a cash
                  sale to a repeat wholesale customer had no way to link their AR/statement of account
                  either. Now shared across both tabs, same as customer name above. */}
              {canPickCustomer && customers.length > 0 ? (
                <div className="mb-3">
                  <label className="mb-1.5 block text-xs font-bold uppercase text-farm-muted">Registered wholesale buyer (optional)</label>
                  <SelectField value={pickedCustomerId} onChange={setPickedCustomerId} placeholder="Not linked — walk-in / one-off" options={customers.map((c) => ({value: c.id, label: c.name}))} />
                  <p className="mt-1 text-[10px] text-farm-muted">Different from a Buy Stock vendor — this tracks a repeat buyer who resells your produce, so their outstanding balance shows up in Customers &amp; Credit.</p>
                </div>
              ) : null}
              <label className="mb-3 flex min-h-10 cursor-pointer items-center justify-between rounded-xl border border-farm-accent-soft bg-farm-accent-soft/40 px-3 font-bold text-farm-ink">
                <span className="flex items-center gap-2"><input type="checkbox" checked={applyDiscount} onChange={(e) => setApplyDiscount(e.target.checked)} className="h-4 w-4 accent-farm-green" /> Include 10% Discount</span>
                {applyDiscount ? <span className="tabular text-farm-green">− {formatPeso(discountNum)}</span> : null}
              </label>

              {saleKind === 'paid' ? (
                <>
                  {payAccounts.length > 0 ? (
                    <div className="mb-3">
                      <label className="mb-1.5 block text-xs font-bold uppercase text-farm-muted">Money received into</label>
                      <SelectField value={payAccountId} onChange={setPayAccountId}
                        options={[{value: '', label: 'Cash (drawer)'}, ...payAccounts.map((a) => ({value: a.id, label: `${a.name}${a.provider ? ` · ${a.provider}` : ''}`}))]} />
                    </div>
                  ) : null}
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
                  {/* owner 2026-07-04: numpad is optional for wholesale/delivery — Skip-Weigh bulk lines carry a
                      negotiated flat price, so a receipt prints with no weighing and no cash count up-front. */}
                  <p className="rounded-lg border border-farm-accent-soft bg-farm-bg p-2 text-[11px] font-semibold text-farm-muted">
                    No weighing or numpad needed here — for negotiated wholesale, add lines with <strong className="text-farm-green">Skip Weigh (Bulk Flat Price)</strong> and issue the receipt. Cash is collected later via <strong className="text-farm-green">Mark Paid</strong> in the journal.
                  </p>
                  <div className="rounded-xl border border-farm-accent-soft bg-farm-accent-soft/40 p-3 text-sm">
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
              {payAccounts.length > 0 ? (
                <div className="mb-3">
                  <label className="mb-1.5 block text-xs font-bold uppercase text-farm-muted">Money received into</label>
                  <SelectField value={payAccountId} onChange={setPayAccountId}
                    options={[{value: '', label: 'Cash (drawer)'}, ...payAccounts.map((a) => ({value: a.id, label: `${a.name}${a.provider ? ` · ${a.provider}` : ''}`}))]} />
                </div>
              ) : null}
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
              <div className={`mx-auto max-w-sm font-mono text-sm receipt-${receiptWidth}mm`} id="pos-slip">
                <p className="text-center text-base font-bold uppercase tracking-wide text-farm-green">Pick Ur Veggie Farm</p>
                <p className="mb-3 text-center text-[10px] italic text-farm-muted">"Fresh from our harvest poly-tunnels to you"</p>
                <p className="text-[10px] text-farm-muted">{new Date(lastSale?.invoice.created_at ?? Date.now()).toLocaleString('en-PH')}</p>
                <p className="text-[11px] font-bold text-farm-ink">
                  Slip #{lastSale?.invoice.invoice_number != null ? String(lastSale.invoice.invoice_number).padStart(5, '0') : 'PENDING SYNC'}
                  {lastSale?.provisional ? ' · saved offline' : ''}
                </p>
                {lastSale?.invoice.posted_by ? <p className="text-[10px] text-farm-muted">Cashier: <span className="font-semibold text-farm-ink">{lastSale.invoice.posted_by}</span></p> : null}
                {lastSale?.invoice.customer_name ? <p className="text-[10px] text-farm-muted">Customer: <span className="font-semibold text-farm-ink">{lastSale.invoice.customer_name}</span></p> : null}
                <p className="mb-2 text-[10px] font-bold text-farm-green">
                  Permit Type: <span className="bg-farm-accent-soft px-1 text-[9px] uppercase tracking-wider">{lastSale?.invoice.status === 'Unpaid' ? 'Pre-Order delivery' : 'Retail PAID Receipt'}</span>
                </p>
                <div className="space-y-1.5 border-y border-dashed border-farm-accent py-2">
                  {lastSale?.invoice.lines.map((l, i) => (
                    <div key={i} className="flex justify-between gap-4">
                      <span className="leading-tight">{l.name}{l.weight_kg !== null ? <span className="block text-[10px] text-farm-muted">{l.weight_kg} kg × {formatPeso(l.unit_price)}/kg</span> : null}</span>
                      <span className="tabular font-bold">{formatPeso(l.line_total)}</span>
                    </div>
                  ))}
                </div>
                {(lastSale?.invoice.saved ?? 0) > 0 ? (
                  <p className="mt-2 rounded bg-farm-accent-soft p-1.5 text-right text-[10px] font-bold text-farm-green">Applied 10% farm discount — saved {formatPeso(lastSale!.invoice.saved!)}!</p>
                ) : null}
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
          <h3 className="mb-2 text-lg font-bold text-farm-danger">Request void — slip #{voidTarget.invoice_number != null ? String(voidTarget.invoice_number).padStart(5, '0') : '—'}?</h3>
          {/* P2N2 (2026-07-19): voiding is now a request, not a unilateral click — a pos.void holder
              who is NOT you reviews it on the Approvals screen. Nothing reverses until they approve. */}
          <p className="mb-3 text-sm text-farm-muted">Sends this slip to Approvals for review. Nothing is reversed yet — a manager who did not file this request approves or rejects it there.</p>
          <div className="flex flex-wrap items-center gap-2">
            <input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="Reason (required)…" aria-label="Void reason" className="min-h-12 flex-1 rounded-lg border border-farm-accent px-3 text-sm" />
            <Button variant="secondary" onClick={() => {setVoidTarget(null); setVoidReason('');}} disabled={busy}>Cancel</Button>
            <Button variant="danger" onClick={() => void commitVoid()} disabled={busy || !voidReason.trim()}>{busy ? 'SENDING…' : 'REQUEST VOID'}</Button>
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
          {/* Ported from Team B, owner 2026-07-16: export touches financial totals (Total,
              RetailTotal, Saved, Status) — admin+ only (accounting.read). */}
          {has('accounting.read') && (
            <Button
              variant="secondary"
              onClick={() => {
                const rows = invoices ?? [];
                if (rows.length === 0) return notify('No listings to export.', 'error');
                const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
                const csv = ['Date,Slip,Type,PostedBy,Total,RetailTotal,Saved,Status,Note',
                  ...rows.map((t) => [t.created_at, `#${t.invoice_number ?? ''}`, t.sale_type ?? 'retail', t.posted_by ?? '', t.total, t.retail_total ?? t.total, t.saved ?? 0, t.status, esc(t.note ?? '')].join(','))].join('\n');
                const url = URL.createObjectURL(new Blob([csv], {type: 'text/csv;charset=utf-8'}));
                const a = document.createElement('a');
                a.href = url; a.download = 'pickurveggie_sales_journal.csv';
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              <Download size={18} aria-hidden /> Export Journal (CSV)
            </Button>
          )}
        </div>
        <div className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-farm-accent-soft bg-farm-bg/50 p-4 md:grid-cols-4">
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="j-date">Filter Date</label>
            <input id="j-date" type="date" value={journalDate} onChange={(e) => setJournalDate(e.target.value)} className="min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-card p-2 text-sm font-semibold" />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted">Sale Type</label>
            <SelectField value={journalType} onChange={setJournalType} options={[{value: 'all', label: 'All Types'}, {value: 'retail', label: 'Retail (Discounted Weight)'}, {value: 'wholesale', label: 'Wholesale (Bulk pre-orders)'}]} />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted">Payment Status</label>
            <SelectField value={journalStatus} onChange={setJournalStatus} options={[{value: 'all', label: 'All Statuses'}, {value: 'Paid', label: 'Paid (Cleared)'}, {value: 'Unpaid', label: 'Pre-orders (Unpaid)'}, {value: 'Voided', label: 'Voided'}, {value: 'PendingSync', label: 'Pending Sync'}]} />
          </div>
          <div className="flex items-end">
            <Button variant="secondary" className="w-full" onClick={() => {setJournalDate(''); setJournalType('all'); setJournalStatus('all');}}>Reset Filters</Button>
          </div>
        </div>
        {/* Card list, not a table (owner directive 2026-07-21, mirroring the Stitch mobile-adaptation
            pass for this exact screen — its own mockup uses a card list here too). Every column and
            every conditional action button is unchanged from the table version, just re-laid-out. */}
        <div className="space-y-2">
          {(invoices ?? [])
            .filter((t) => (journalDate ? t.created_at.slice(0, 10) === journalDate : true))
            .filter((t) => (journalType === 'all' ? true : (t.sale_type ?? 'retail') === journalType))
            .filter((t) => (journalStatus === 'all' ? true : t.status === journalStatus))
            .map((t) => (
              <div key={t.id} className={cn('rounded-xl border border-farm-accent-soft bg-farm-card p-3', t.status === 'Voided' && 'opacity-60')}>
                <div className="mb-1.5 flex items-center justify-between gap-2 border-b border-dashed border-farm-accent-soft pb-1.5">
                  <span className="flex items-center gap-1.5">
                    <span className={cn('font-mono text-xs font-bold', t.status === 'Voided' && 'line-through')}>{t.invoice_number != null ? `#${String(t.invoice_number).padStart(5, '0')}` : '—'}</span>
                    <span className={cn('rounded px-1.5 py-0.5 text-[9px] font-bold uppercase', (t.sale_type ?? 'retail') === 'retail' ? 'bg-farm-accent-soft text-farm-green' : 'bg-amber-100 text-amber-800')}>
                      {t.sale_type ?? 'retail'}
                    </span>
                  </span>
                  <span className={cn('rounded-full px-2 py-0.5 text-[9px] font-bold uppercase',
                    t.status === 'Paid' ? 'bg-farm-accent-soft text-farm-green'
                    : t.status === 'Unpaid' ? 'bg-amber-100 text-amber-800'
                    : t.status === 'Voided' ? 'bg-red-100 text-farm-danger'
                    : 'bg-blue-100 text-blue-900')}>
                    {t.status === 'Unpaid' ? 'Pre-order' : t.status === 'PendingSync' ? 'Pending Sync' : t.status}
                  </span>
                </div>
                <div className={cn('mb-2 flex items-end justify-between gap-2', t.status === 'Voided' && 'line-through')}>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-farm-ink" title={t.note ?? undefined}>{t.note ? <span className="italic">{t.note}</span> : t.lines.map((l) => l.name).join(', ')}</p>
                    <p className="tabular text-[10px] text-farm-muted">{new Date(t.created_at).toLocaleString('en-PH')} · {t.posted_by ?? '—'}</p>
                  </div>
                  <span className="tabular flex-shrink-0 text-sm font-black text-farm-green">{formatPeso(t.total)}</span>
                </div>
                <div className="flex justify-end gap-1.5 border-t border-farm-accent-soft pt-1.5">
                  {t.status === 'Unpaid' && canSettle ? (
                    <button onClick={() => {setSettleTarget(t); setCash(''); setPayAccountId(''); setPane('settle');}} className="rounded border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-800 hover:bg-amber-100">Mark Paid</button>
                  ) : null}
                  {/* P2N2 (2026-07-19): filing is pos.sell-gated (anyone can request); approving is
                      pos.void-gated on the Approvals screen, by someone other than the requester. */}
                  {t.status !== 'Voided' && t.status !== 'PendingSync' && canSell ? (
                    <button onClick={() => {setVoidTarget(t); setVoidReason('');}} className="rounded px-2 py-1 text-xs font-semibold text-farm-danger hover:bg-red-50">Request Void</button>
                  ) : null}
                  <button onClick={() => {setLastSale({invoice: t, provisional: false}); setPane('receipt');}} className="rounded border border-farm-accent-soft px-2.5 py-1 text-xs font-bold text-farm-green hover:bg-farm-accent-soft" aria-label={`Print slip #${t.invoice_number ?? ''}`}>
                    <Printer className="h-3.5 w-3.5" aria-hidden />
                  </button>
                  {t.status !== 'Voided' && !canSell && !canSettle ? <Lock className="h-3.5 w-3.5 text-farm-accent" aria-hidden /> : null}
                </div>
              </div>
            ))}
          {(invoices ?? []).length === 0 ? (
            <p className="py-8 text-center text-sm italic text-farm-muted">No sales recorded on this device yet.</p>
          ) : null}
        </div>
      </Card>

      {/* Crop Pricing Menu (prototype Catalog Manager). Add/edit-price stay product.manage-only; Remove is
          also reachable with product.remove (queues for approval instead of removing instantly). No hard delete. */}
      <Dialog.Root open={pricingOpen} onOpenChange={setPricingOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[92vw] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-2xl bg-farm-card p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between border-b border-farm-accent-soft pb-3">
              <Dialog.Title className="text-xl font-black text-farm-green">🥬 POS Vegetable Catalog Administrator</Dialog.Title>
              <Dialog.Close className="rounded p-1 text-farm-muted hover:text-farm-ink" aria-label="Close"><X size={20} aria-hidden /></Dialog.Close>
            </div>
            {canManageProducts && pendingRemovals.length > 0 ? (
              <div className="mb-5 rounded-xl border border-amber-300 bg-amber-50 p-3">
                <h4 className="mb-2 text-xs font-black uppercase tracking-wider text-amber-800">Pending Product Removals ({pendingRemovals.length})</h4>
                <ul className="space-y-2">
                  {pendingRemovals.map((r) => (
                    <li key={r.id} className="rounded-lg border border-amber-200 bg-white p-2.5 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-farm-ink">{r.product_name}</span>
                        <span className="text-[11px] text-farm-muted">requested by {r.requester_name}</span>
                      </div>
                      <p className="mt-0.5 text-xs italic text-farm-muted">&quot;{r.reason}&quot;</p>
                      <div className="mt-2 flex justify-end gap-2">
                        <button disabled={busy} onClick={() => setRejectTarget(r)} className="rounded-lg border border-farm-accent px-2.5 py-1 text-xs font-bold text-farm-muted hover:bg-farm-bg">Reject</button>
                        <button disabled={busy} onClick={() => void approveRemoval(r)} className="rounded-lg bg-farm-danger px-2.5 py-1 text-xs font-bold text-white hover:opacity-90">Approve removal</button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className={cn('grid grid-cols-1 gap-6', canManageProducts && 'md:grid-cols-2')}>
              {canManageProducts ? (
              <div className="space-y-3 md:border-r md:border-farm-accent-soft md:pr-4">
                <h4 className="text-xs font-black uppercase tracking-wider text-farm-green">Register New Vegetable Item</h4>
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="pm-name">Crop / Vegetable name</label>
                  <input id="pm-name" value={pmName} onChange={(e) => setPmName(e.target.value)} placeholder="e.g. Red Cherry Tomatoes" className="min-h-12 w-full rounded-lg border border-farm-accent bg-farm-bg px-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-farm-green-500" />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="pm-price">Base retail price (₱ per kg)</label>
                  <input id="pm-price" value={pmPrice} onChange={(e) => setPmPrice(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder="e.g. 150" className="tabular min-h-12 w-full rounded-lg border border-farm-accent bg-farm-bg px-3 text-right text-sm font-bold outline-none focus:ring-2 focus:ring-farm-green-500" />
                  {parseFloat(pmPrice) > 0 ? <p className="mt-1 text-[11px] text-farm-muted">Cashier grid will charge {formatPeso(farmPerKg(parseFloat(pmPrice)))}/kg (farm price)</p> : null}
                </div>
                <Button
                  className="w-full"
                  disabled={busy || !pmName.trim() || !(parseFloat(pmPrice) > 0)}
                  onClick={async () => {
                    if (!companyId) return;
                    setBusy(true);
                    try {
                      await posApi.addProduct(companyId, pmName, round2(parseFloat(pmPrice)));
                      notify(`${pmName.trim()} added to the cashier grid`);
                      setPmName(''); setPmPrice('');
                      reload();
                    } catch (e) { notify(e instanceof Error ? e.message : 'Add failed', 'error'); } finally { setBusy(false); }
                  }}
                >
                  Save to Cashier Grid
                </Button>
              </div>
              ) : null}
              <div className="space-y-3">
                <h4 className="text-xs font-black uppercase tracking-wider text-farm-green">Edit Normal Retail Prices</h4>
                <div className="max-h-72 space-y-2.5 overflow-y-auto pr-1">
                  {(products ?? []).map((p) => (
                    <div key={p.id} className="rounded-lg border border-farm-accent-soft bg-farm-bg p-2.5 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-farm-ink">{p.name}</span>
                        <span className="font-mono text-[11px] text-farm-muted">Retail: {formatPeso(p.retail_per_kg)}</span>
                      </div>
                      {pmEditingId === p.id ? (
                        <div className="mt-2 flex gap-1.5">
                          <input value={pmEditPrice} onChange={(e) => setPmEditPrice(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder="New rate…" aria-label={`New price for ${p.name}`} className="tabular min-h-10 flex-1 rounded border border-farm-accent bg-farm-card px-2 text-right text-xs font-bold outline-none" />
                          <button
                            disabled={busy || !(parseFloat(pmEditPrice) > 0)}
                            onClick={async () => {
                              setBusy(true);
                              try {
                                await posApi.updateProductPrice(p, round2(parseFloat(pmEditPrice)));
                                notify(`${p.name} price updated`);
                                setPmEditingId(null); setPmEditPrice('');
                                reload();
                              } catch (e) { notify(e instanceof Error ? e.message : 'Update failed', 'error'); } finally { setBusy(false); }
                            }}
                            className="rounded bg-farm-green px-3 text-xs font-bold text-white disabled:opacity-40"
                          >
                            OK
                          </button>
                          <button onClick={() => {setPmEditingId(null); setPmEditPrice('');}} className="rounded bg-farm-accent-soft px-3 text-xs font-bold text-farm-muted">✕</button>
                        </div>
                      ) : (
                        <div className="mt-1.5 flex justify-end gap-3 text-[11px] font-bold">
                          {canManageProducts ? <button onClick={() => {setPmEditingId(p.id); setPmEditPrice(String(p.retail_per_kg));}} className="text-farm-green hover:underline">Edit Price</button> : null}
                          {canRequestRemove ? (
                            <button disabled={busy} onClick={() => {setRemoveTarget(p); setRemoveReason('');}} className="text-farm-danger hover:underline">
                              Remove
                            </button>
                          ) : null}
                        </div>
                      )}
                    </div>
                  ))}
                  {(products ?? []).length === 0 ? <p className="py-6 text-center text-sm italic text-farm-muted">No crops available to manage.</p> : null}
                </div>
              </div>
            </div>
            <div className="mt-5 border-t border-farm-accent-soft pt-4 text-right">
              <Button variant="secondary" onClick={() => setPricingOpen(false)}>Done &amp; Apply</Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Remove confirmation — product.manage removes instantly; product.remove-only queues for approval */}
      <Dialog.Root open={removeTarget !== null} onOpenChange={(o) => {if (!o) setRemoveTarget(null);}}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-farm-card p-6 shadow-xl">
            <Dialog.Title className="mb-2 text-lg font-bold text-farm-danger">
              {removeTarget ? `Remove ${removeTarget.name}?` : ''}
            </Dialog.Title>
            <Dialog.Description className="mb-4 text-sm text-farm-muted">
              {canManageProducts
                ? 'This hides it from the cashier grid — sales history is kept, and you can restore it later. This removes it immediately, no approval needed.'
                : 'This queues a removal request. A product manager must approve it before the item disappears from the cashier grid.'}
            </Dialog.Description>
            <textarea
              value={removeReason}
              onChange={(e) => setRemoveReason(e.target.value)}
              placeholder="Reason for removal (required) — e.g. out of season, discontinued"
              rows={3}
              className="min-h-20 w-full resize-none rounded-lg border border-farm-accent-soft bg-farm-bg px-3 py-2 text-sm"
              aria-label="Reason for removal"
            />
            <div className="mt-5 flex gap-2 border-t border-farm-accent-soft pt-4">
              <Button variant="secondary" onClick={() => setRemoveTarget(null)} disabled={busy}>Cancel</Button>
              <Button className="flex-1" variant="danger" onClick={() => void submitRemove()} disabled={busy || removeReason.trim().length < 3}>
                {busy ? 'Working…' : canManageProducts ? 'Remove now' : 'Request removal'}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Reject a pending removal request — product.manage only */}
      <Dialog.Root open={rejectTarget !== null} onOpenChange={(o) => {if (!o) setRejectTarget(null);}}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-farm-card p-6 shadow-xl">
            <Dialog.Title className="mb-2 text-lg font-bold text-farm-ink">
              {rejectTarget ? `Reject removal of ${rejectTarget.product_name}?` : ''}
            </Dialog.Title>
            <Dialog.Description className="mb-4 text-sm text-farm-muted">
              The product stays on the cashier grid. {rejectTarget?.requester_name} will see this was declined.
            </Dialog.Description>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Reason (optional) — e.g. still selling well, keep it"
              rows={3}
              className="min-h-20 w-full resize-none rounded-lg border border-farm-accent-soft bg-farm-bg px-3 py-2 text-sm"
              aria-label="Reason for rejection"
            />
            <div className="mt-5 flex gap-2 border-t border-farm-accent-soft pt-4">
              <Button variant="secondary" onClick={() => setRejectTarget(null)} disabled={busy}>Cancel</Button>
              <Button className="flex-1" onClick={() => void submitReject()} disabled={busy}>{busy ? 'Working…' : 'Reject request'}</Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
