// Shared crop scaffolding — a two-pane master/detail + local-first cache hook, reused by all crop screens
// (no architecture duplication). Search is client-side over the scoped Dexie cache (M1B F2).
import {useCallback, useEffect, useState, type ReactNode} from 'react';
import {useLiveQuery} from 'dexie-react-hooks';
import {Plus, Search} from 'lucide-react';
import type {Table} from 'dexie';
import {Button, Card, PageHeader, cn} from '../../components/ui';
import {EmptyState, Skeleton} from '../../components/feedback';
import {ConfirmDialog} from '../../components/overlay';

export function nz(v: string | undefined | null): string | null {
  return v && v.trim() ? v.trim() : null;
}

// Archive = a status update (no hard delete). Confirms first (Section 25 error prevention).
export function ArchiveButton({disabled, onArchive}: {disabled?: boolean; onArchive: () => void | Promise<void>}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button variant="danger" disabled={disabled} onClick={() => setOpen(true)}>Archive</Button>
      <ConfirmDialog
        open={open}
        busy={busy}
        title="Archive this item?"
        description="Archived items remain for history but cannot be used in new records."
        confirmLabel="Archive"
        danger
        onCancel={() => setOpen(false)}
        onConfirm={async () => {setBusy(true); await onArchive(); setBusy(false); setOpen(false);}}
      />
    </>
  );
}

interface Scoped {
  id: string;
  company_id: string;
}

// Fetch from server → cache in Dexie → reactive local-first read (works offline).
export function useSyncedCrop<T extends Scoped>(
  table: Table<T, string>,
  companyId: string | null,
  fetcher: (companyId: string) => Promise<T[]>,
): {items: T[] | undefined; loaded: boolean; reload: () => void} {
  const [loaded, setLoaded] = useState(false);
  const items = useLiveQuery(async () => (companyId ? table.where('company_id').equals(companyId).toArray() : []), [companyId]);
  const reload = useCallback(() => {
    if (!companyId) return;
    fetcher(companyId).then((rows) => table.bulkPut(rows)).catch(() => undefined).finally(() => setLoaded(true));
  }, [companyId, fetcher, table]);
  useEffect(reload, [reload]);
  return {items, loaded, reload};
}

export function MasterDetail<T extends {id: string}>(props: {
  title: string;
  subtitle?: string;
  items: T[] | undefined;
  loaded: boolean;
  query: string;
  onQuery: (q: string) => void;
  matches: (item: T, q: string) => boolean;
  renderRow: (item: T) => ReactNode;
  selected: string | 'new' | null;
  onSelect: (id: string | 'new' | null) => void;
  canManage: boolean;
  newLabel: string;
  emptyTitle: string;
  emptyHint?: string;
  detail: ReactNode;
  widthClass?: string;
}) {
  const q = props.query.trim().toLowerCase();
  const filtered = (props.items ?? []).filter((i) => (q ? props.matches(i, q) : true));
  return (
    <div>
      <PageHeader
        title={props.title}
        subtitle={props.subtitle}
        action={props.canManage ? <Button onClick={() => props.onSelect('new')}><Plus size={20} aria-hidden /> {props.newLabel}</Button> : undefined}
      />
      <div className={cn('grid gap-5', props.widthClass ?? 'lg:grid-cols-[1fr_1.2fr]')}>
        <Card>
          <div className="mb-3 flex items-center gap-2 rounded-xl border border-farm-accent px-3">
            <Search size={20} className="text-farm-muted" aria-hidden />
            <input
              value={props.query}
              onChange={(e) => props.onQuery(e.target.value)}
              placeholder="Search…"
              className="min-h-12 flex-1 bg-transparent text-lg outline-none"
              aria-label="Search"
            />
          </div>
          {!props.loaded && !props.items?.length ? (
            <Skeleton />
          ) : filtered.length === 0 ? (
            <EmptyState title={q ? 'No matches' : props.emptyTitle} hint={q ? undefined : props.emptyHint} action={!q && props.canManage ? <Button onClick={() => props.onSelect('new')}>{props.newLabel}</Button> : undefined} />
          ) : (
            <ul className="divide-y divide-farm-accent-soft">
              {filtered.map((item) => (
                <li key={item.id}>
                  <button onClick={() => props.onSelect(item.id)} className={cn('flex min-h-16 w-full items-center justify-between gap-2 px-2 text-left', props.selected === item.id && 'bg-farm-accent-soft')}>
                    {props.renderRow(item)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div>{props.detail}</div>
      </div>
    </div>
  );
}
