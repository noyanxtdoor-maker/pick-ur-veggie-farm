// Farm Inventory Control (P2-M3B) — prototype-parity: src/features/Inventory.tsx is the workflow authority.
// Consumables tab: per-category live stock cards (balances DERIVED server-side; mock mirrors), low-stock alerts,
// purchase modal (w/ autocomplete from past receivings + Quick Restock prefill), manual audit adjustment (reason
// mandatory). Equipment tab: catalog + condition checklist + inspection history. All writes via inventoryApi
// (governed functions; B5 offline-queued).
import {useCallback, useEffect, useMemo, useState} from 'react';
import {useLiveQuery} from 'dexie-react-hooks';
import * as Dialog from '@radix-ui/react-dialog';
import {AlertTriangle, ClipboardList, FileText, Hammer, History, Minus, Package, Plus, ReceiptText, RefreshCw, ShieldAlert, ShoppingBag, X} from 'lucide-react';
import {offlineDB} from '../../core/offline/db';
import {hydrateBranches} from '../../core/offline/hydrate';
import {useSync} from '../../core/offline/sync';
import {usePermissions} from '../../core/permissions/permissions';
import {Button, Card, PageHeader, cn} from '../../components/ui';
import {EmptyState, Skeleton, useToast} from '../../components/feedback';
import {SelectField} from '../../components/overlay';
import {formatPeso, round2} from '../pos/money';
import {inventoryApi, type PurchaseInput} from './api';
import {purchaseSummary, filterByPeriod} from './purchaseSummary';
import {membershipsApi} from '../organization/memberships/memberships';
import type {EquipmentAsset, EquipmentLog, InventoryItem, InventoryMovement, ItemCategory, PermissionKey, PurchaseReceiving} from '../../types/db';

const todayISO = () => new Date().toISOString().slice(0, 10);
const ONLINE_SOURCES = ['Lazada', 'Shopee', 'TikTok'];

// P2-M3B (owner 2026-07-18): tabs were previously unconditional once past the page-level gate — anyone
// with ANY inventory permission saw all 4, including Purchase Summary's spend totals. Now each tab checks
// its own key(s), mirroring OperationsLayout.tsx's established pattern.
type InvTab = 'consumables' | 'equipment' | 'purchases' | 'usage';
const TAB_DEFS: Array<{key: InvTab; label: string; icon: typeof ShoppingBag; perms: readonly PermissionKey[]}> = [
  {key: 'consumables', label: 'Consumables & Seed Stocks', icon: ShoppingBag, perms: ['inventory.purchase', 'inventory.adjust']},
  {key: 'equipment', label: 'Heavy Equipment & Spades', icon: Hammer, perms: ['equipment.manage']},
  {key: 'purchases', label: 'Purchase Summary', icon: ReceiptText, perms: ['inventory.reports.read']},
  {key: 'usage', label: 'Usage History', icon: History, perms: ['inventory.adjust']},
];

export default function InventoryScreen() {
  const {companyId, has} = usePermissions();
  const {refreshTick} = useSync();
  const {notify} = useToast();
  const canPurchase = has('inventory.purchase');
  const canAdjust = has('inventory.adjust');
  const canEquip = has('equipment.manage');
  const canViewReports = has('inventory.reports.read');
  const visibleTabs = TAB_DEFS.filter((t) => t.perms.some(has));

  useEffect(() => {if (companyId) hydrateBranches(companyId);}, [companyId]);
  const branches = useLiveQuery(async () => (companyId ? offlineDB.branches.where('company_id').equals(companyId).filter((b) => b.status === 'Active').toArray() : []), [companyId]);
  const [branchId, setBranchId] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!branchId && branches && branches.length > 0) setBranchId(branches[0]!.id);
  }, [branches, branchId]);

  const [tab, setTab] = useState<InvTab>('consumables');
  useEffect(() => {
    if (visibleTabs.length > 0 && !visibleTabs.some((t) => t.key === tab)) setTab(visibleTabs[0]!.key);
  }, [visibleTabs.map((t) => t.key).join(','), tab]); // eslint-disable-line react-hooks/exhaustive-deps
  const [categories, setCategories] = useState<ItemCategory[]>([]);
  const [items, setItems] = useState<InventoryItem[] | null>(null);
  const [receivings, setReceivings] = useState<PurchaseReceiving[]>([]);
  const [equipment, setEquipment] = useState<EquipmentAsset[]>([]);
  const [logs, setLogs] = useState<EquipmentLog[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [actorNames, setActorNames] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    if (!companyId || !branchId) return;
    inventoryApi.fetchCategories(companyId).then(setCategories).catch(() => setCategories([]));
    inventoryApi.fetchItems(companyId, branchId).then(setItems).catch(() => setItems([]));
    inventoryApi.fetchReceivings(companyId, branchId).then(setReceivings).catch(() => setReceivings([]));
    inventoryApi.fetchEquipment(companyId, branchId).then(setEquipment).catch(() => setEquipment([]));
    inventoryApi.fetchEquipmentLogs(companyId).then(setLogs).catch(() => setLogs([]));
    inventoryApi.fetchMovements(companyId, branchId).then(setMovements).catch(() => setMovements([]));
    membershipsApi.fetch(companyId).then((rows) => setActorNames(new Map(rows.map((m) => [m.user_id, m.userName])))).catch(() => setActorNames(new Map()));
  }, [companyId, branchId]);
  useEffect(reload, [reload, refreshTick]); // refreshTick: manual sync (top-bar wifi tap) re-fetches this screen

  // ── purchase modal ──
  const [buyOpen, setBuyOpen] = useState(false);
  const [buyDate, setBuyDate] = useState(todayISO());
  const [buyType, setBuyType] = useState<'Consumables' | 'Equipment'>('Consumables');
  const [buyCategory, setBuyCategory] = useState('seeds');
  const [buyDesc, setBuyDesc] = useState('');
  const [buyQty, setBuyQty] = useState('1');
  const [buySourceType, setBuySourceType] = useState<'online' | 'physical'>('online');
  const [buySourceName, setBuySourceName] = useState('Lazada');
  const [buyContact, setBuyContact] = useState('');
  const [buyAmount, setBuyAmount] = useState('');

  // ── adjustment modal ──
  const [adjOpen, setAdjOpen] = useState(false);
  const [adjItemId, setAdjItemId] = useState('');
  const [adjQty, setAdjQty] = useState('');
  const [adjReason, setAdjReason] = useState('');

  // ── log usage modal (owner 2026-07-04: worker-friendly "we used 1kg fertilizer" — same governed
  //    adjustment ledger underneath, always a negative movement with a "Used:" reason) ──
  const [useOpen, setUseOpen] = useState(false);
  const [useItemId, setUseItemId] = useState('');
  const [useQty, setUseQty] = useState('');
  const [usePurpose, setUsePurpose] = useState('');

  // ── low-stock limit + equipment checklist ──
  const [limitInput, setLimitInput] = useState('10');
  const [checkAsset, setCheckAsset] = useState<EquipmentAsset | null>(null);
  const [checkWorking, setCheckWorking] = useState(true);
  const [checkMaint, setCheckMaint] = useState(false);
  const [checkInspector, setCheckInspector] = useState('');
  const [checkNotes, setCheckNotes] = useState('');

  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const itemById = useMemo(() => new Map((items ?? []).map((i) => [i.id, i])), [items]);
  const usageRows = useMemo(() => movements.filter((m) => m.movement_type === 'AdjustmentDecrease'), [movements]);

  // ── Purchase Summary report (period-filtered aggregation over receivings) ──
  const [sumFrom, setSumFrom] = useState('');
  const [sumTo, setSumTo] = useState('');
  const summary = useMemo(() => purchaseSummary(filterByPeriod(receivings, sumFrom, sumTo), itemById, catById), [receivings, sumFrom, sumTo, itemById, catById]);
  const consumableCategories = categories.filter((c) => c.category_key !== 'equipment');

  // per-category aggregates (mock cards): total pcs, cumulative ₱, latest restock/source
  const cards = useMemo(() => {
    return consumableCategories.map((c) => {
      const catItems = (items ?? []).filter((i) => i.category_id === c.id);
      if (catItems.length === 0) return null;
      const ids = new Set(catItems.map((i) => i.id));
      const recvs = receivings.filter((r) => ids.has(r.item_id));
      const latest = recvs[0] ?? null; // receivings sorted newest-first
      return {
        category: c,
        totalPcs: round2(catItems.reduce((s, i) => s + i.available, 0)),
        cost: round2(recvs.reduce((s, r) => s + r.total_amount, 0)),
        latest,
        isLow: catItems.some((i) => i.available <= i.reorder_level),
      };
    }).filter((x): x is NonNullable<typeof x> => x !== null);
  }, [consumableCategories, items, receivings]);
  const anyLow = cards.some((c) => c.isLow);

  // autocomplete suggestions: latest receiving per distinct item (mock "Frequent Descriptions")
  const suggestions = useMemo(() => {
    const seen = new Map<string, PurchaseReceiving>();
    for (const r of receivings) {
      const item = itemById.get(r.item_id);
      if (!item || item.inventory_type === 'Equipment') continue;
      if (!seen.has(item.name.toLowerCase())) seen.set(item.name.toLowerCase(), r);
    }
    return [...seen.values()].slice(0, 8);
  }, [receivings, itemById]);

  const openBuy = (prefillCategoryKey?: string) => {
    setBuyDate(todayISO());
    setBuyType('Consumables');
    setBuyCategory(prefillCategoryKey ?? 'seeds');
    setBuyDesc(''); setBuyQty('1'); setBuySourceType('online'); setBuySourceName('Lazada'); setBuyContact(''); setBuyAmount('');
    if (prefillCategoryKey) {
      const cat = categories.find((c) => c.category_key === prefillCategoryKey);
      const latest = receivings.find((r) => itemById.get(r.item_id)?.category_id === cat?.id);
      if (latest) {
        setBuyDesc(itemById.get(latest.item_id)?.name ?? '');
        setBuySourceType(latest.source_type);
        setBuySourceName(latest.source_name);
        setBuyContact(latest.source_contact ?? '');
      }
    }
    setBuyOpen(true);
  };

  async function submitPurchase() {
    if (!companyId || !branchId) return;
    const input: PurchaseInput = {
      categoryKey: buyType === 'Equipment' ? 'equipment' : buyCategory,
      itemName: buyDesc, isEquipment: buyType === 'Equipment',
      quantity: parseFloat(buyQty), totalCost: parseFloat(buyAmount),
      sourceType: buySourceType, sourceName: buySourceName, sourceContact: buyContact, purchaseDate: buyDate,
    };
    if (!(input.quantity > 0) || !(input.totalCost > 0)) return notify('Amounts and counts must be larger than zero.', 'error');
    setBusy(true);
    try {
      await inventoryApi.recordPurchase(companyId, branchId, input);
      notify('Purchase logged — stock and books updated');
      setBuyOpen(false);
      reload();
    } catch (e) { notify(e instanceof Error ? e.message : 'Purchase failed', 'error'); } finally { setBusy(false); }
  }

  async function submitAdjust() {
    if (!companyId || !branchId) return;
    const item = itemById.get(adjItemId);
    const qty = parseFloat(adjQty);
    if (!item) return notify('Choose a material to adjust.', 'error');
    if (isNaN(qty) || qty === 0) return notify('Adjustment must be a non-zero quantity (e.g. -5 or 10).', 'error');
    setBusy(true);
    try {
      const bal = await inventoryApi.adjust(companyId, branchId, item, qty, adjReason);
      notify(bal === null ? 'Adjustment queued — will sync' : `Adjusted — ${item.name} now ${bal} ${item.base_unit}`);
      setAdjOpen(false); setAdjQty(''); setAdjReason('');
      reload();
    } catch (e) { notify(e instanceof Error ? e.message : 'Adjustment failed', 'error'); } finally { setBusy(false); }
  }

  async function submitUsage() {
    if (!companyId || !branchId) return;
    const item = itemById.get(useItemId);
    const qty = parseFloat(useQty);
    if (!item) return notify('Choose the material that was used.', 'error');
    if (isNaN(qty) || qty <= 0) return notify('Enter how much was used (a positive amount).', 'error');
    if (qty > item.available) return notify(`Only ${item.available} ${item.base_unit} of ${item.name} is on hand.`, 'error');
    setBusy(true);
    try {
      const bal = await inventoryApi.adjust(companyId, branchId, item, -qty, `Used: ${usePurpose.trim()}`);
      notify(bal === null ? 'Usage logged — will sync' : `Usage logged — ${item.name} now ${bal} ${item.base_unit}`);
      setUseOpen(false); setUseQty(''); setUsePurpose('');
      reload();
    } catch (e) { notify(e instanceof Error ? e.message : 'Usage log failed', 'error'); } finally { setBusy(false); }
  }

  async function submitCheck() {
    if (!companyId || !checkAsset) return;
    setBusy(true);
    try {
      await inventoryApi.logCheck(companyId, checkAsset, checkWorking, checkMaint, checkInspector, checkNotes);
      notify('Condition check logged');
      setCheckAsset(null); setCheckNotes('');
      reload();
    } catch (e) { notify(e instanceof Error ? e.message : 'Checklist failed', 'error'); } finally { setBusy(false); }
  }

  const lastChecked = (assetId: string) => {
    const l = logs.find((x) => x.equipment_id === assetId);
    return l ? new Date(l.performed_date).toLocaleDateString('en-PH') : 'Never';
  };

  if (!canPurchase && !canAdjust && !canEquip && !canViewReports) {
    return (
      <div>
        <PageHeader title="Farm Inventory Control" />
        <Card><EmptyState title="Inventory access needed" hint="Your role does not include any inventory permission. Ask a manager to grant it." /></Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Farm Inventory Control"
        subtitle="Automatic tracking of consumables and heavy machinery inputs — synced as purchase receipts are booked"
        action={
          <div className="w-56">
            <SelectField value={branchId} onChange={setBranchId} placeholder="Branch" options={(branches ?? []).map((b) => ({value: b.id, label: b.name}))} />
          </div>
        }
      />

      <div className="flex flex-wrap gap-2.5">
        {/* Two doors, one engine (owner 2026-07-04): "Buy Stock" = things that become inventory (seeds,
            substrate, packaging, equipment); "Log Expense" = services you consume (water/electricity,
            transport, misc) — the server books each to the right account automatically. */}
        {canPurchase ? (
          <Button onClick={() => openBuy()}><Plus size={18} aria-hidden /> Buy Stock</Button>
        ) : null}
        {canPurchase ? (
          <Button variant="secondary" onClick={() => openBuy('utilities')}><FileText size={18} aria-hidden /> Log Expense</Button>
        ) : null}
        {canAdjust ? (
          <Button variant="secondary" onClick={() => {setUseItemId((items ?? [])[0]?.id ?? ''); setUseQty(''); setUsePurpose(''); setUseOpen(true);}}>
            <Minus size={18} aria-hidden /> Log Stock Usage
          </Button>
        ) : null}
        {canAdjust ? (
          <Button variant="secondary" onClick={() => {setAdjItemId((items ?? [])[0]?.id ?? ''); setAdjQty(''); setAdjReason(''); setAdjOpen(true);}}>
            <RefreshCw size={18} aria-hidden /> Manual Stock Adjustment
          </Button>
        ) : null}
      </div>

      {/* tabs (prototype; P2-M3B: now permission-gated — a tab only renders if the actor holds a key for it) */}
      <div className="flex flex-wrap gap-2 border-b border-farm-accent pb-0.5" role="tablist">
        {visibleTabs.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
              className={cn('flex min-h-12 items-center gap-2 rounded-t-xl px-6 text-sm font-bold transition', tab === t.key ? 'border-x border-t border-farm-accent bg-farm-card text-farm-green' : 'text-farm-muted hover:bg-farm-card/40 hover:text-farm-green')}>
              <Icon className="h-4 w-4" aria-hidden /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'usage' ? (
        <div className="animate-fade-in space-y-6">
          <Card>
            <h3 className="mb-1 flex items-center gap-2 text-lg font-bold text-farm-green"><History className="h-5 w-5" aria-hidden /> Stock Usage History</h3>
            <p className="mb-4 text-xs text-farm-muted">Every time stock leaves the shelf — logged usage or an audit correction — shows here: what, when, and who.</p>
            {usageRows.length === 0 ? (
              <EmptyState title="No usage recorded yet" hint="Use 'Log Stock Usage' or 'Manual Stock Adjustment' to record materials leaving inventory." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-farm-accent-soft text-left text-xs font-bold tracking-wider text-farm-muted">
                      <th className="pb-2">Date</th><th className="pb-2">Material</th><th className="pb-2 text-right">Quantity</th>
                      <th className="pb-2">Reason</th><th className="pb-2">Used By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-farm-accent-soft">
                    {usageRows.map((m) => {
                      const item = m.item_id ? itemById.get(m.item_id) : undefined;
                      const isUsage = (m.reason ?? '').startsWith('Used:');
                      return (
                        <tr key={m.id}>
                          <td className="py-2.5 font-mono text-xs">{new Date(m.created_at).toLocaleString('en-PH')}</td>
                          <td className="py-2.5 font-bold text-farm-ink">{item?.name ?? 'Unknown material'}</td>
                          <td className="tabular py-2.5 text-right text-farm-danger">−{m.quantity} {item?.base_unit ?? ''}</td>
                          <td className="py-2.5">
                            <span className={cn('mr-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase', isUsage ? 'bg-farm-accent-soft text-farm-green' : 'bg-amber-100 text-amber-800')}>
                              {isUsage ? 'Usage' : 'Correction'}
                            </span>
                            {isUsage ? (m.reason ?? '').slice('Used:'.length).trim() : m.reason}
                          </td>
                          <td className="py-2.5 font-semibold text-farm-muted">{m.actor_user_id ? (actorNames.get(m.actor_user_id) ?? '(unknown)') : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      ) : null}

      {tab === 'purchases' ? (
        <div className="animate-fade-in space-y-6">
          <Card>
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-2 text-lg font-bold text-farm-green"><ReceiptText className="h-5 w-5" aria-hidden /> Purchase Summary</h3>
                <p className="text-xs text-farm-muted">Every purchase you log flows in here automatically — no re-typing. See what you bought and where the money went.</p>
              </div>
              <div className="flex items-end gap-2">
                <label className="text-[10px] font-bold uppercase text-farm-muted">From<input type="date" value={sumFrom} onChange={(e) => setSumFrom(e.target.value)} className="mt-1 block min-h-10 rounded-lg border border-farm-accent-soft bg-farm-bg px-2 text-sm" /></label>
                <label className="text-[10px] font-bold uppercase text-farm-muted">To<input type="date" value={sumTo} onChange={(e) => setSumTo(e.target.value)} className="mt-1 block min-h-10 rounded-lg border border-farm-accent-soft bg-farm-bg px-2 text-sm" /></label>
                {sumFrom || sumTo ? <button onClick={() => {setSumFrom(''); setSumTo('');}} className="min-h-10 rounded-lg border border-farm-accent px-2.5 text-xs font-bold text-farm-green hover:bg-farm-accent-soft">All time</button> : null}
              </div>
            </div>
            <div className="mb-5 flex flex-wrap items-baseline gap-x-6 gap-y-1 border-y border-farm-accent-soft py-3">
              <span className="text-sm text-farm-muted">Total spent: <strong className="tabular text-lg font-black text-farm-green">{formatPeso(summary.total)}</strong></span>
              <span className="text-sm text-farm-muted">Across <strong className="font-bold text-farm-ink">{summary.count}</strong> purchase{summary.count === 1 ? '' : 's'}</span>
            </div>
            {summary.count === 0 ? (
              <EmptyState title="No purchases in this period" hint="Log purchases with “Buy Stock” or “Log Expense” — they appear here automatically." />
            ) : (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <SummaryTable title="By category" rows={summary.byCategory} />
                <SummaryTable title="By source (store / platform)" rows={summary.bySource} showQty={false} />
              </div>
            )}
          </Card>
        </div>
      ) : null}

      {tab === 'consumables' ? (
        <div className="animate-fade-in space-y-6">
          {anyLow ? (
            <p className="flex items-start gap-2.5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-farm-danger" role="alert">
              <ShieldAlert className="h-5 w-5 flex-shrink-0" aria-hidden />
              <span><span className="block uppercase">Restock Warnings Active</span>
              <span className="font-semibold text-red-900">One or more materials are at or below their alert limit. Procure seeds, nutrients, or packaging quickly.</span></span>
            </p>
          ) : null}

          {items === null ? (
            <Skeleton rows={3} />
          ) : cards.length === 0 ? (
            <Card><EmptyState title="No consumable material logs available" hint="Input seeds or nutrients purchases to start tracking real-time stock levels." /></Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {cards.map(({category, totalPcs, cost, latest, isLow}) => (
                <Card key={category.id} className={cn(isLow && 'border-red-300')}>
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <span className="text-xs font-bold uppercase tracking-wide text-farm-muted">{category.name}</span>
                    {isLow ? (
                      <span className="flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-1 text-[10px] font-black uppercase text-farm-danger"><AlertTriangle className="h-3 w-3" aria-hidden /> Critical Stock</span>
                    ) : (
                      <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-bold uppercase text-emerald-800">Sufficient</span>
                    )}
                  </div>
                  <p className="tabular text-4xl font-black text-farm-green">{totalPcs} <span className="text-sm font-bold uppercase text-farm-muted">pcs/units</span></p>
                  <p className="mt-1 text-xs text-farm-muted">Cumulative expense value: <span className="font-bold text-farm-green">{formatPeso(cost)}</span></p>
                  {latest ? (
                    <div className="mt-4 space-y-1 border-t border-farm-accent-soft pt-3 text-[11px] text-farm-muted">
                      <p>Last Restocked: <span className="font-mono font-semibold text-farm-ink">{latest.received_date}</span></p>
                      <p>Source: <span className="rounded bg-farm-bg px-1.5 py-0.5 font-semibold uppercase text-farm-ink">{latest.source_type === 'online' ? `Online (${latest.source_name})` : `Supplier (${latest.source_name})`}</span></p>
                    </div>
                  ) : null}
                  {canPurchase ? (
                    <div className="mt-4 flex justify-end border-t border-farm-accent-soft pt-3">
                      <button onClick={() => openBuy(category.category_key)} className="flex items-center gap-1 rounded-lg bg-farm-accent-soft px-3 py-1.5 text-[11px] font-bold uppercase text-farm-green transition hover:bg-farm-green hover:text-white">
                        <Plus className="h-3 w-3" aria-hidden /> Quick Restock
                      </button>
                    </div>
                  ) : null}
                </Card>
              ))}
            </div>
          )}

          {canAdjust && (items ?? []).length > 0 ? (
            <Card className="max-w-xs">
              <label className="mb-1.5 block text-xs font-bold uppercase text-farm-muted" htmlFor="inv-limit">Configure Low-Stock Limit</label>
              <div className="flex gap-2">
                <input id="inv-limit" value={limitInput} onChange={(e) => setLimitInput(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="numeric" className="tabular min-h-12 w-full rounded-lg border border-farm-accent bg-farm-bg px-3 text-center text-lg font-black outline-none" />
                <Button
                  variant="secondary"
                  disabled={busy || limitInput === ''}
                  onClick={async () => {
                    if (!companyId) return;
                    setBusy(true);
                    try {
                      await inventoryApi.setLowStockLimit(companyId, parseFloat(limitInput) || 0);
                      notify(`Alert limit set to ${limitInput} for all materials`);
                      reload();
                    } catch (e) { notify(e instanceof Error ? e.message : 'Failed', 'error'); } finally { setBusy(false); }
                  }}
                >
                  Apply
                </Button>
              </div>
            </Card>
          ) : null}
        </div>
      ) : tab === 'equipment' ? (
        <div className="animate-fade-in space-y-6">
          <Card>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-lg font-bold text-farm-green"><ClipboardList className="h-5 w-5" aria-hidden /> Heavy Equipment Catalog &amp; Checklist</h3>
              <span className="text-[11px] text-farm-muted">Tracks active condition checks</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-farm-accent-soft text-left text-xs font-bold tracking-wider text-farm-muted">
                    <th className="pb-3 text-center">Status</th>
                    <th className="pb-3">Equipment Name</th>
                    <th className="pb-3">Purchase Date</th>
                    <th className="pb-3 text-right">Cost</th>
                    <th className="pb-3">Last Checked</th>
                    <th className="pb-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-farm-accent-soft text-sm">
                  {equipment.map((a) => (
                    <tr key={a.id} className="hover:bg-farm-bg/30">
                      <td className="py-3 text-center">
                        <span className={cn('rounded-full px-2.5 py-1 text-[10px] font-bold uppercase',
                          a.condition === 'Broken' ? 'bg-red-100 text-farm-danger'
                          : a.condition === 'Needs Maintenance' ? 'bg-amber-100 text-amber-800'
                          : 'bg-farm-accent-soft text-farm-green')}>
                          {a.condition === 'Broken' ? 'Out of Order' : a.condition === 'Good' ? 'Operational' : a.condition}
                        </span>
                      </td>
                      <td className="py-3 font-bold text-farm-green">{a.name}</td>
                      <td className="tabular py-3 text-xs">{a.purchase_date ?? '—'}</td>
                      <td className="tabular py-3 text-right font-black">{formatPeso(a.purchase_cost)}</td>
                      <td className="py-3 font-mono text-xs text-farm-muted">{lastChecked(a.id)}</td>
                      <td className="py-3 text-right">
                        <button
                          disabled={!canEquip}
                          onClick={() => {setCheckAsset(a); setCheckWorking(a.condition !== 'Broken'); setCheckMaint(false); setCheckInspector(''); setCheckNotes('');}}
                          className="rounded-lg border border-farm-accent bg-farm-bg px-3 py-1.5 text-xs font-black text-farm-green transition hover:bg-farm-accent-soft disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Fill Checklist
                        </button>
                      </td>
                    </tr>
                  ))}
                  {equipment.length === 0 ? (
                    <tr><td colSpan={6} className="py-12 text-center text-sm italic text-farm-muted">No equipment registered. Purchase pumps or spades and mark them as Equipment.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Card>

          {logs.length > 0 ? (
            <Card>
              <h3 className="mb-4 text-base font-extrabold text-farm-green">Inspection History Log Book</h3>
              <div className="space-y-4">
                {equipment.filter((a) => logs.some((l) => l.equipment_id === a.id)).map((a) => (
                  <div key={a.id} className="space-y-2 border-l-4 border-farm-green py-1 pl-4">
                    <p className="flex items-center gap-2 text-sm font-bold text-farm-green">{a.name}
                      <span className="rounded bg-farm-bg px-2 py-0.5 text-[10px] font-normal text-farm-muted">history count: {logs.filter((l) => l.equipment_id === a.id).length}</span>
                    </p>
                    <div className="grid grid-cols-1 gap-3 text-xs text-farm-muted md:grid-cols-2">
                      {logs.filter((l) => l.equipment_id === a.id).map((l) => (
                        <div key={l.id} className="space-y-1 rounded-lg border border-farm-accent-soft bg-farm-bg/50 p-3">
                          <p className="flex items-center justify-between text-[10px] font-bold">
                            <span>Date: {new Date(l.performed_date).toLocaleDateString('en-PH')}</span>
                            <span className="bg-farm-accent-soft px-1 font-mono text-[9px] uppercase text-farm-green">checked by: {l.performed_by_name}</span>
                          </p>
                          <p className="flex gap-2">
                            {l.working ? <span className="rounded bg-emerald-100 px-1.5 text-[9px] font-bold text-emerald-800">Operational</span> : <span className="rounded bg-red-100 px-1.5 text-[9px] font-bold text-farm-danger">Stopped Working</span>}
                            {l.needs_maintenance ? <span className="rounded bg-amber-100 px-1.5 text-[9px] font-bold text-amber-800">Required fixing</span> : null}
                          </p>
                          {l.notes ? <p className="font-semibold italic text-farm-ink">" {l.notes} "</p> : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
        </div>
      ) : null}

      {/* Purchase modal (prototype "Add Materials Purchase") */}
      <Dialog.Root open={buyOpen} onOpenChange={setBuyOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[88vh] w-[92vw] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-2xl bg-farm-card p-6 shadow-xl">
            <div className="mb-1 flex items-center justify-between">
              <Dialog.Title className="text-xl font-bold text-farm-green">Add Materials Purchase</Dialog.Title>
              <Dialog.Close className="rounded p-1 text-farm-muted hover:text-farm-ink" aria-label="Close"><X size={20} aria-hidden /></Dialog.Close>
            </div>
            <p className="mb-5 text-xs text-farm-muted">Logs as a cost transaction in accounting and material value in inventory levels.</p>
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="buy-date">Purchase Date</label>
                  <input id="buy-date" type="date" value={buyDate} onChange={(e) => setBuyDate(e.target.value)} className="min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg p-2 text-sm font-semibold" />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted">Material Classification</label>
                  <SelectField value={buyType} onChange={(v) => setBuyType(v as 'Consumables' | 'Equipment')} options={[{value: 'Consumables', label: 'Consumables (Seeds, nutrients…)'}, {value: 'Equipment', label: 'Equipment (Pumps, machinery…)'}]} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted">Consumable Category</label>
                  {buyType === 'Consumables' ? (
                    <>
                      <SelectField value={buyCategory} onChange={setBuyCategory} options={consumableCategories.map((c) => ({value: c.category_key, label: c.name}))} />
                      <p className="mt-1 text-[9px] leading-tight text-farm-muted">
                        {['utilities', 'transport', 'misc'].includes(buyCategory)
                          ? 'Service expense — books straight to Operating Expenses (no stock added).'
                          : 'Stock purchase — adds to inventory and the books automatically.'}
                      </p>
                    </>
                  ) : (
                    <p className="flex min-h-12 items-center rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm font-semibold opacity-70">Equipment Purchase</p>
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="buy-qty">Quantity (pcs/units)</label>
                  <input id="buy-qty" value={buyQty} onChange={(e) => setBuyQty(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="numeric" className="tabular min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-right text-sm font-bold" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="buy-desc">Item Description / Item Name</label>
                <input id="buy-desc" value={buyDesc} onChange={(e) => setBuyDesc(e.target.value)} placeholder="e.g. F1 organic eggplant seeds pack or Submersible Pump" className="min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm" />
                {suggestions.length > 0 && buyType === 'Consumables' ? (
                  <div className="mt-2">
                    <span className="block text-[9px] font-bold uppercase text-farm-muted">Frequent descriptions (tap to auto-fill):</span>
                    <div className="mt-1 flex max-h-24 flex-wrap gap-1.5 overflow-y-auto rounded-xl border border-farm-accent-soft bg-farm-bg/50 p-2">
                      {suggestions.map((r) => {
                        const item = itemById.get(r.item_id);
                        const cat = item ? catById.get(item.category_id) : undefined;
                        return (
                          <button key={r.id} type="button"
                            onClick={() => {
                              if (!item) return;
                              setBuyDesc(item.name);
                              if (cat) setBuyCategory(cat.category_key);
                              setBuySourceType(r.source_type); setBuySourceName(r.source_name); setBuyContact(r.source_contact ?? '');
                            }}
                            className="rounded-lg border border-farm-accent-soft bg-farm-card px-2.5 py-1.5 text-[11px] font-bold text-farm-ink transition hover:border-farm-green hover:bg-farm-accent-soft">
                            🌱 {item?.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted">Purchase Location</label>
                  <SelectField value={buySourceType} onChange={(v) => {const t = v as 'online' | 'physical'; setBuySourceType(t); setBuySourceName(t === 'online' ? 'Lazada' : '');}} options={[{value: 'online', label: 'Online eCommerce Platforms'}, {value: 'physical', label: 'Physical Dealer / Supplier Store'}]} />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="buy-src">Source / Platform Name</label>
                  {buySourceType === 'online' ? (
                    <SelectField value={buySourceName} onChange={setBuySourceName} options={ONLINE_SOURCES.map((s) => ({value: s, label: `${s} Philippines`}))} />
                  ) : (
                    <input id="buy-src" value={buySourceName} onChange={(e) => setBuySourceName(e.target.value)} placeholder="e.g. Agri-Supply Co. Malolos" className="min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm" />
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="buy-who">Supplier / Broker Contact</label>
                  <input id="buy-who" value={buyContact} onChange={(e) => setBuyContact(e.target.value)} placeholder="e.g. Aling Sandra / Makati Store" className="min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm" />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="buy-amt">Purchase Total Price (₱)</label>
                  <input id="buy-amt" value={buyAmount} onChange={(e) => setBuyAmount(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder="0.00" className="tabular min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-right text-sm font-bold" />
                </div>
              </div>
            </div>
            <div className="mt-5 flex gap-2 border-t border-farm-accent-soft pt-4">
              <Button variant="secondary" onClick={() => setBuyOpen(false)} disabled={busy}>Cancel</Button>
              <Button className="flex-1" onClick={() => void submitPurchase()} disabled={busy || !buyDesc.trim() || !(parseFloat(buyAmount) > 0) || !(parseFloat(buyQty) > 0)}>
                {busy ? 'Saving…' : 'Save & Log Purchase'}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Log usage modal — the everyday "we used it" flow (posts a negative audited movement at FIFO cost) */}
      <Dialog.Root open={useOpen} onOpenChange={setUseOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-farm-card p-6 shadow-xl">
            <Dialog.Title className="flex items-center justify-center gap-1.5 text-lg font-bold text-farm-green"><Minus className="h-5 w-5" aria-hidden /> Log Stock Usage</Dialog.Title>
            <p className="mb-5 mt-1 text-center text-xs text-farm-muted">Record materials the team used today — e.g. “1 kg fertilizer for Tunnel 3”. Stock goes down and the cost is booked automatically.</p>
            <div className="space-y-4 text-sm">
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted">Material Used</label>
                <SelectField value={useItemId} onChange={setUseItemId} options={(items ?? []).map((i) => ({value: i.id, label: `${i.name} — ${i.available} ${i.base_unit} on hand`}))} placeholder="Choose material…" />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="use-qty">How much was used?</label>
                <input id="use-qty" value={useQty} onChange={(e) => setUseQty(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder={`e.g. 1 (${itemById.get(useItemId)?.base_unit ?? 'units'})`} className="tabular min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-right text-sm font-bold" />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="use-purpose">What was it used for? (required)</label>
                <input id="use-purpose" value={usePurpose} onChange={(e) => setUsePurpose(e.target.value)} placeholder="e.g. Fertilizing Tunnel 3 lettuce beds" className="min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm" />
              </div>
            </div>
            <div className="mt-5 flex gap-2 border-t border-farm-accent-soft pt-4">
              <Button variant="secondary" onClick={() => setUseOpen(false)} disabled={busy}>Cancel</Button>
              <Button className="flex-1" onClick={() => void submitUsage()} disabled={busy || !useItemId || !usePurpose.trim() || !(parseFloat(useQty) > 0)}>
                {busy ? 'Logging…' : 'LOG USAGE'}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Manual audit adjustment modal (reason mandatory — 20.09) */}
      <Dialog.Root open={adjOpen} onOpenChange={setAdjOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-farm-card p-6 shadow-xl">
            <Dialog.Title className="flex items-center justify-center gap-1.5 text-lg font-bold text-farm-green"><RefreshCw className="h-5 w-5" aria-hidden /> Manual Stock Audit Adjustment</Dialog.Title>
            <p className="mb-5 mt-1 text-center text-xs text-farm-muted">Adjustments register as audited ledger corrections — spillage, damage, theft, or excess counts found.</p>
            <div className="space-y-4 text-sm">
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted">Material</label>
                <SelectField value={adjItemId} onChange={setAdjItemId} options={(items ?? []).map((i) => ({value: i.id, label: `${i.name} — ${i.available} ${i.base_unit}`}))} placeholder="Choose material…" />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="adj-qty">Adjustment Offset (Quantity)</label>
                <input id="adj-qty" value={adjQty} onChange={(e) => setAdjQty(e.target.value.replace(/[^0-9.-]/g, ''))} inputMode="numeric" placeholder="e.g. -5 to subtract, 10 to add" className="tabular min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-right text-sm font-bold" />
                <p className="mt-1 text-[10px] text-farm-muted">Negative = spillage/damage/theft (posts shrinkage at FIFO cost). Positive = excess found.</p>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="adj-reason">Auditing Verification Remarks (required)</label>
                <textarea id="adj-reason" value={adjReason} onChange={(e) => setAdjReason(e.target.value)} placeholder="e.g. Cleared 5 packs spoiled substrate bags due to moisture exposure." className="h-24 w-full rounded-xl border border-farm-accent-soft bg-farm-bg p-3 text-sm focus:outline-none" />
              </div>
            </div>
            <div className="mt-5 flex gap-2 border-t border-farm-accent-soft pt-4">
              <Button variant="secondary" onClick={() => setAdjOpen(false)} disabled={busy}>Cancel Audit</Button>
              <Button className="flex-1" onClick={() => void submitAdjust()} disabled={busy || !adjItemId || !adjReason.trim() || !adjQty}>
                {busy ? 'Committing…' : 'COMMIT AUDIT CORRECTION'}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Equipment checklist modal */}
      <Dialog.Root open={checkAsset !== null} onOpenChange={(o) => {if (!o) setCheckAsset(null);}}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-farm-card p-6 shadow-xl">
            <Dialog.Title className="text-center text-lg font-bold text-farm-green">Equipment Condition Checklist</Dialog.Title>
            <p className="mb-5 mt-1 text-center text-xs text-farm-muted">Routine diagnostic evaluation for: <span className="font-bold underline">{checkAsset?.name}</span></p>
            <div className="space-y-4 text-sm">
              <p className="flex items-center justify-between rounded-xl border border-farm-accent-soft bg-farm-bg p-3 text-xs font-semibold">
                <span>Registered Cost:</span><span className="font-extrabold text-farm-green">{formatPeso(checkAsset?.purchase_cost ?? 0)}</span>
              </p>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => setCheckWorking(true)} className={cn('min-h-12 rounded-xl px-3 text-sm font-bold transition', checkWorking ? 'bg-farm-green text-white' : 'bg-farm-bg text-farm-muted')}>Working / Operational</button>
                <button onClick={() => setCheckWorking(false)} className={cn('min-h-12 rounded-xl px-3 text-sm font-bold transition', !checkWorking ? 'bg-farm-danger text-white' : 'bg-farm-bg text-farm-muted')}>Out of Order / Broken</button>
              </div>
              <label className="flex min-h-12 cursor-pointer items-center gap-2 rounded-xl bg-farm-bg p-3 text-xs font-bold text-farm-green">
                <input type="checkbox" checked={checkMaint} onChange={(e) => setCheckMaint(e.target.checked)} className="h-4 w-4 accent-farm-green" />
                Flag as 'Requires Maintenance / Servicing'
              </label>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="chk-insp">Diagnosing Inspector / Technician</label>
                <input id="chk-insp" value={checkInspector} onChange={(e) => setCheckInspector(e.target.value)} placeholder="Enter inspector name…" className="min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="chk-notes">Inspecting Status Remarks</label>
                <textarea id="chk-notes" value={checkNotes} onChange={(e) => setCheckNotes(e.target.value)} placeholder="e.g. Cleared cylinder filters, running well with no leaks." className="h-20 w-full rounded-xl border border-farm-accent-soft bg-farm-bg p-3 text-sm focus:outline-none" />
              </div>
            </div>
            <div className="mt-5 flex gap-2 border-t border-farm-accent-soft pt-4">
              <Button variant="secondary" onClick={() => setCheckAsset(null)} disabled={busy}>Cancel Check-In</Button>
              <Button className="flex-1" onClick={() => void submitCheck()} disabled={busy || !checkInspector.trim()}>
                {busy ? 'Logging…' : 'LOG PERFORMANCE CHECK'}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {(items ?? []).length === 0 && tab === 'consumables' && !canPurchase ? (
        <p className="flex items-center gap-2 text-sm text-farm-muted"><Package size={16} aria-hidden /> Purchases need the inventory.purchase permission.</p>
      ) : null}
      {tab === 'consumables' && cards.length === 0 && items !== null ? (
        <p className="flex items-center gap-2 text-xs text-farm-muted"><FileText size={14} aria-hidden /> Stock levels are derived from the tamper-proof movement ledger — never typed in.</p>
      ) : null}
    </div>
  );
}

function SummaryTable({title, rows, showQty = true}: {title: string; rows: Array<{key: string; label: string; total: number; count: number; qty: number; pct: number}>; showQty?: boolean}) {
  return (
    <div>
      <h4 className="mb-2 text-xs font-black uppercase tracking-wider text-farm-muted">{title}</h4>
      <div className="space-y-2.5">
        {rows.map((r) => (
          <div key={r.key}>
            <div className="mb-1 flex items-baseline justify-between text-xs">
              <span className="font-bold text-farm-ink">{r.label}</span>
              <span className="tabular font-bold text-farm-green">{formatPeso(r.total)} <span className="text-[10px] font-semibold text-farm-muted">{r.pct.toFixed(1)}%{showQty ? ` · ${r.qty} units` : ''} · {r.count}×</span></span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-farm-accent-soft"><div className="h-full rounded-full bg-farm-green" style={{width: `${Math.min(r.pct, 100)}%`}} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}
