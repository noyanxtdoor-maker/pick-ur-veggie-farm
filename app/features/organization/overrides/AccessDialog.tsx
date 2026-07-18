// P1C3 (2026-07-17): the "Section Access" panel — supersedes P1C2's ModuleAccessDialog. Sections now
// mirror the real nav bar (owner: "Sections are the 'Home Dashboard', Weigh POS, and everything is in
// the nav bar"). Progressive disclosure per leaf: Not Visible / Visible first; once Visible, a second
// row reveals View-only vs Edit & Manage (only for leaves that actually have both a read and a manage
// key — a manage-only leaf like Company just shows Not Visible / Edit & Manage directly, a read-only
// leaf like Reports just shows Not Visible / Visible). Sections with tabs (Operations; Approvals &
// Roles) render as an expand/collapse group — the section header is a LOCAL UI convenience only (not
// persisted); each tab underneath is its own independently-saved leaf, exactly like a tabless section.
//
// P1C4 (2026-07-17): generalized from "always edits one user's overrides" to a subject-agnostic
// dialog — the caller supplies `getTier`/`applyTier` closures instead of a companyId+userId, so the
// SAME dialog now also drives the Roles tab's default-access editor (app/features/organization/roles/
// roleAccess.ts) without any subject-type branching inside this file.
import {useEffect, useMemo, useState} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {Lock, ShieldCheck, X, ChevronDown, ChevronRight} from 'lucide-react';
import {Button} from '../../../components/ui';
import {useToast} from '../../../components/feedback';
import {tiersFor, SECTION_TREE, type AccessTier, type AccessLeaf, type AccessSection} from './access';

interface Selections { [leafKey: string]: AccessTier }

interface Props {
  title: string;
  subtitle?: string;
  open: boolean;
  onClose: () => void;
  getTier: (leaf: AccessLeaf) => Promise<AccessTier>;
  applyTier: (leaf: AccessLeaf, target: AccessTier) => Promise<void>;
  savedMessage: (changedCount: number) => string;
}

function leavesOf(section: AccessSection): AccessLeaf[] {
  return section.leaf ? [section.leaf] : (section.tabs ?? []);
}

function colorFor(tier: AccessTier, current: AccessTier): string {
  if (current !== tier) return 'border-farm-accent-soft text-farm-muted hover:bg-farm-accent-soft';
  if (tier === 'none') return 'border-farm-danger bg-farm-danger text-white';
  if (tier === 'view') return 'border-amber-500 bg-amber-500 text-white';
  return 'border-farm-green bg-farm-green text-white';
}

function LeafRow({leaf, tier, onPick, noneLabel}: {leaf: AccessLeaf; tier: AccessTier; onPick: (t: AccessTier) => void; noneLabel?: string}) {
  const tiers = tiersFor(leaf);
  const threeState = tiers.length === 3;
  const isVisible = tier !== 'none';
  const noneText = noneLabel ?? 'Not Visible';

  if (!threeState) {
    const other = (tiers.find((t) => t !== 'none') ?? 'view') as AccessTier;
    const otherLabel = other === 'manage' ? 'Edit & Manage' : 'Visible';
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 py-2.5">
        <p className="text-sm font-bold text-farm-ink">{leaf.label}</p>
        <div className="flex gap-1.5">
          <button type="button" onClick={() => onPick('none')} aria-pressed={tier === 'none'} className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold ${colorFor('none', tier)}`}>
            <Lock className="h-3 w-3" aria-hidden /> {noneText}
          </button>
          <button type="button" onClick={() => onPick(other)} aria-pressed={tier === other} className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold ${colorFor(other, tier)}`}>
            <ShieldCheck className="h-3 w-3" aria-hidden /> {otherLabel}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-bold text-farm-ink">{leaf.label}</p>
        <div className="flex gap-1.5">
          <button type="button" onClick={() => onPick('none')} aria-pressed={!isVisible} className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold ${!isVisible ? 'border-farm-danger bg-farm-danger text-white' : 'border-farm-accent-soft text-farm-muted hover:bg-farm-accent-soft'}`}>
            <Lock className="h-3 w-3" aria-hidden /> {noneText}
          </button>
          <button type="button" onClick={() => onPick(tier === 'none' ? 'view' : tier)} aria-pressed={isVisible} className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold ${isVisible ? 'border-farm-green bg-farm-green text-white' : 'border-farm-accent-soft text-farm-muted hover:bg-farm-accent-soft'}`}>
            <ShieldCheck className="h-3 w-3" aria-hidden /> Visible
          </button>
        </div>
      </div>
      {isVisible ? (
        <div className="mt-1.5 flex justify-end gap-1.5">
          <button type="button" onClick={() => onPick('view')} aria-pressed={tier === 'view'} className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${colorFor('view', tier)}`}>View-only</button>
          <button type="button" onClick={() => onPick('manage')} aria-pressed={tier === 'manage'} className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${colorFor('manage', tier)}`}>Edit & Manage</button>
        </div>
      ) : null}
    </div>
  );
}

export function AccessDialog({title, subtitle, open, onClose, getTier, applyTier, savedMessage}: Props) {
  const {notify} = useToast();
  const [selections, setSelections] = useState<Selections>({});
  const [tiers, setTiers] = useState<Selections>({});
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({operations: true, organization: true, inventory: true});

  const reload = () => {
    setLoaded(false); setSelections({}); setTiers({});
    (async () => {
      const next: Selections = {};
      for (const section of SECTION_TREE) {
        for (const leaf of leavesOf(section)) {
          next[leaf.key] = await getTier(leaf);
        }
      }
      setTiers(next);
      setSelections({...next});
      setLoaded(true);
    })().catch((e) => notify(e instanceof Error ? e.message : 'Failed to load access', 'error'));
  };

  useEffect(() => {if (open) reload(); /* eslint-disable-line react-hooks/exhaustive-deps */}, [open]);

  const dirty = useMemo(() => Object.keys(selections).some((k) => selections[k] !== tiers[k]), [selections, tiers]);

  async function apply() {
    setBusy('apply');
    try {
      const allLeaves = SECTION_TREE.flatMap(leavesOf);
      const changed = allLeaves.filter((l) => selections[l.key] !== tiers[l.key]);
      for (const leaf of changed) await applyTier(leaf, selections[leaf.key]!);
      notify(savedMessage(changed.length));
      onClose();
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Update failed', 'error');
    } finally { setBusy(null); }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => {if (!o) onClose();}}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[88vh] w-[94vw] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-farm-card p-6 shadow-xl">
          <div className="mb-1 flex items-start justify-between">
            <div>
              <Dialog.Title className="flex items-center gap-2 text-xl font-bold text-farm-green">
                <ShieldCheck className="h-5 w-5" aria-hidden /> {title}
              </Dialog.Title>
              <p className="mt-1 text-sm text-farm-muted">
                {subtitle ?? <>Each section gets a tier. <strong>Not Visible</strong> hides it; <strong>Visible</strong> reveals whether they can only view it or also edit & manage it.</>}
              </p>
            </div>
            <Dialog.Close className="rounded p-1 text-farm-muted hover:text-farm-ink" aria-label="Close"><X size={20} aria-hidden /></Dialog.Close>
          </div>

          {!loaded ? (
            <p className="py-4 text-sm text-farm-muted">Loading…</p>
          ) : (
            <ul className="mt-3 divide-y divide-farm-accent-soft">
              {SECTION_TREE.map((section) => {
                if (section.leaf) {
                  return (
                    <li key={section.key}>
                      <LeafRow leaf={section.leaf} tier={selections[section.leaf.key] ?? 'none'} noneLabel={section.noneLabel}
                        onPick={(t) => setSelections((s) => ({...s, [section.leaf!.key]: t}))} />
                      {section.alwaysVisible ? <p className="pb-2 text-[11px] text-farm-muted">This page always stays reachable — "{section.noneLabel ?? 'Not Visible'}" shows only their own record, it never disappears.</p> : null}
                    </li>
                  );
                }
                const tabs = section.tabs ?? [];
                const visibleCount = tabs.filter((t) => (selections[t.key] ?? 'none') !== 'none').length;
                const isOpen = expanded[section.key] ?? false;
                return (
                  <li key={section.key} className="py-1">
                    <button type="button" onClick={() => setExpanded((e) => ({...e, [section.key]: !isOpen}))}
                      className="flex w-full items-center justify-between gap-2 py-1.5 text-left">
                      <span className="flex items-center gap-1.5 text-sm font-bold text-farm-ink">
                        {isOpen ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
                        {section.label}
                      </span>
                      <span className="text-[11px] text-farm-muted">{visibleCount} of {tabs.length} tabs visible</span>
                    </button>
                    {isOpen ? (
                      <ul className="ml-5 divide-y divide-farm-accent-soft border-l border-farm-accent-soft pl-3">
                        {tabs.map((tab) => (
                          <li key={tab.key}>
                            <LeafRow leaf={tab} tier={selections[tab.key] ?? 'none'} onPick={(t) => setSelections((s) => ({...s, [tab.key]: t}))} />
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}

          <div className="mt-5 flex items-center justify-between border-t border-farm-accent-soft pt-4">
            <p className="text-xs text-farm-muted">{dirty ? 'Pending changes shown above' : 'No pending changes'}</p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={onClose} disabled={busy !== null}>Close</Button>
              <Button onClick={apply} disabled={busy !== null || !dirty}>
                {busy ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
