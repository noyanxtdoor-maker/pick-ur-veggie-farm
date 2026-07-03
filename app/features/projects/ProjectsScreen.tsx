// Projects / Project Checklists (P2-M7B) — prototype-parity: src/features/Projects.tsx is the workflow authority.
// Board of project cards, each with status, date range, % complete bar, and an inline task checklist (add + tick).
// Branch-owned (20.x spine); no GL. All writes via projectsApi (RLS-gated; B5 offline-queued).
import {useCallback, useEffect, useMemo, useState} from 'react';
import {useLiveQuery} from 'dexie-react-hooks';
import * as Dialog from '@radix-ui/react-dialog';
import {CheckCircle2, Circle, FolderGit2, Plus, Trash2, X} from 'lucide-react';
import {offlineDB} from '../../core/offline/db';
import {usePermissions} from '../../core/permissions/permissions';
import {Button, Card, PageHeader, cn} from '../../components/ui';
import {EmptyState, Skeleton, useToast} from '../../components/feedback';
import {SelectField} from '../../components/overlay';
import {projectsApi, type ProjectInput} from './api';
import type {Project} from '../../types/db';

const STATUSES: Project['status'][] = ['Planning', 'In Progress', 'Completed', 'On Hold'];
const STATUS_COLOR: Record<string, string> = {
  Planning: 'bg-blue-100 text-blue-800', 'In Progress': 'bg-farm-accent-soft text-farm-green',
  Completed: 'bg-emerald-100 text-emerald-800', 'On Hold': 'bg-amber-100 text-amber-800',
};
const todayISO = () => new Date().toISOString().slice(0, 10);

export default function ProjectsScreen() {
  const {companyId, has} = usePermissions();
  const {notify} = useToast();
  const canRead = has('project.read');
  const canManage = has('project.manage');

  const branches = useLiveQuery(async () => (companyId ? offlineDB.branches.where('company_id').equals(companyId).filter((b) => b.status === 'Active').toArray() : []), [companyId]);
  const [branchId, setBranchId] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!branchId && branches && branches.length > 0) setBranchId(branches[0]!.id);
  }, [branches, branchId]);

  const [projects, setProjects] = useState<Project[] | null>(null);
  const [taskDraft, setTaskDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    if (!companyId || !branchId || !canRead) return;
    projectsApi.fetchProjects(companyId, branchId).then(setProjects).catch(() => setProjects([]));
  }, [companyId, branchId, canRead]);
  useEffect(reload, [reload]);

  // create modal
  const [open, setOpen] = useState(false);
  const [cName, setCName] = useState('');
  const [cDesc, setCDesc] = useState('');
  const [cStart, setCStart] = useState(todayISO());
  const [cEnd, setCEnd] = useState(todayISO());
  const [cStatus, setCStatus] = useState<Project['status']>('In Progress');

  async function submit() {
    if (!companyId || !branchId) return;
    const input: ProjectInput = {name: cName, description: cDesc, start_date: cStart, end_date: cEnd, status: cStatus};
    setBusy(true);
    try {
      await projectsApi.createProject(companyId, branchId, input);
      notify('Project created');
      setOpen(false); setCName(''); setCDesc('');
      reload();
    } catch (e) { notify(e instanceof Error ? e.message : 'Failed', 'error'); } finally { setBusy(false); }
  }

  const wrap = (fn: () => Promise<void>, ok?: string) => async () => {
    setBusy(true);
    try { await fn(); if (ok) notify(ok); reload(); }
    catch (e) { notify(e instanceof Error ? e.message : 'Failed', 'error'); }
    finally { setBusy(false); }
  };

  if (!canRead) {
    return (
      <div>
        <PageHeader title="Project Checklists" />
        <Card><EmptyState title="Projects access needed" hint="Your role does not include the project.read permission." /></Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Farm Projects Board"
        subtitle="Coordinate multi-step farm work — track projects and tick off their task checklists."
        action={
          <div className="flex items-center gap-2">
            <div className="w-40"><SelectField value={branchId} onChange={setBranchId} placeholder="Branch" options={(branches ?? []).map((b) => ({value: b.id, label: b.name}))} /></div>
            {canManage ? <Button onClick={() => {setCName(''); setCDesc(''); setCStart(todayISO()); setCEnd(todayISO()); setCStatus('In Progress'); setOpen(true);}}><Plus size={18} aria-hidden /> New Project</Button> : null}
          </div>
        }
      />

      {projects === null ? (
        <Skeleton rows={4} />
      ) : projects.length === 0 ? (
        <Card><EmptyState title="No projects yet" hint={canManage ? 'Create one with "New Project".' : 'Nothing scheduled on this branch.'} /></Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => {
            const done = p.tasks.filter((t) => t.completed).length;
            const pct = p.tasks.length === 0 ? 0 : Math.round((done / p.tasks.length) * 100);
            const draft = taskDraft[p.id] ?? '';
            return (
              <Card key={p.id} className="flex flex-col">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <h3 className="flex items-center gap-1.5 text-base font-bold text-farm-green"><FolderGit2 className="h-4 w-4 shrink-0" aria-hidden /> {p.name}</h3>
                  {canManage ? (
                    <span className="flex flex-shrink-0 items-center gap-1">
                      <div className="w-28"><SelectField value={p.status} onChange={(v) => void wrap(() => projectsApi.setStatus(p, v as Project['status']))()} options={STATUSES.map((s) => ({value: s, label: s}))} /></div>
                      <button onClick={() => void wrap(() => projectsApi.deleteProject(p), 'Project deleted')()} className="rounded p-1 text-farm-danger hover:bg-red-50" aria-label="Delete project"><Trash2 className="h-4 w-4" aria-hidden /></button>
                    </span>
                  ) : (
                    <span className={cn('rounded-full px-2.5 py-1 text-[10px] font-bold', STATUS_COLOR[p.status])}>{p.status}</span>
                  )}
                </div>
                {p.description ? <p className="mb-2 text-xs text-farm-muted">{p.description}</p> : null}
                <p className="mb-2 text-[11px] font-semibold text-farm-muted">{p.start_date ?? '—'} → {p.end_date ?? '—'}</p>

                <div className="mb-3">
                  <div className="mb-1 flex items-center justify-between text-[11px] font-bold text-farm-muted"><span>{done}/{p.tasks.length} done</span><span>{pct}%</span></div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-farm-accent-soft"><div className="h-full rounded-full bg-farm-green transition-all" style={{width: `${pct}%`}} /></div>
                </div>

                <ul className="mb-3 flex-1 space-y-1">
                  {p.tasks.map((t) => (
                    <li key={t.id}>
                      <button disabled={!canManage || busy} onClick={() => void wrap(() => projectsApi.toggleTask(t, null))()} className="flex w-full items-start gap-2 rounded-lg px-1.5 py-1 text-left text-sm hover:bg-farm-bg/50 disabled:cursor-default">
                        {t.completed ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-farm-green" aria-hidden /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-farm-accent" aria-hidden />}
                        <span className={cn('min-w-0 flex-1', t.completed && 'text-farm-muted line-through')}>{t.text}</span>
                      </button>
                    </li>
                  ))}
                  {p.tasks.length === 0 ? <li className="px-1.5 py-1 text-xs italic text-farm-muted">No tasks yet.</li> : null}
                </ul>

                {canManage ? (
                  <form className="flex gap-2" onSubmit={(e) => {e.preventDefault(); const text = draft.trim(); if (!text) return; void wrap(async () => {await projectsApi.addTask(p, text); setTaskDraft((d) => ({...d, [p.id]: ''}));})();}}>
                    <input value={draft} onChange={(e) => setTaskDraft((d) => ({...d, [p.id]: e.target.value}))} placeholder="Add a task…" className="min-h-10 flex-1 rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm" />
                    <Button type="submit" variant="secondary" disabled={busy || !draft.trim()}><Plus size={16} aria-hidden /></Button>
                  </form>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}

      {/* Create project modal */}
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-1 flex items-center justify-between">
              <Dialog.Title className="text-xl font-bold text-farm-green">New Project</Dialog.Title>
              <Dialog.Close className="rounded p-1 text-farm-muted hover:text-farm-ink" aria-label="Close"><X size={20} aria-hidden /></Dialog.Close>
            </div>
            <p className="mb-5 text-xs text-farm-muted">Create a project card for the selected branch; add its checklist after.</p>
            <div className="space-y-4 text-sm">
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="p-name">Project Name</label>
                <input id="p-name" value={cName} onChange={(e) => setCName(e.target.value)} placeholder="e.g. Rainy-season tunnel retrofit" className="min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="p-desc">Description</label>
                <input id="p-desc" value={cDesc} onChange={(e) => setCDesc(e.target.value)} placeholder="optional" className="min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="p-start">Start</label>
                  <input id="p-start" type="date" value={cStart} onChange={(e) => setCStart(e.target.value)} className="min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg p-2 text-sm font-semibold" />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="p-end">Target End</label>
                  <input id="p-end" type="date" value={cEnd} onChange={(e) => setCEnd(e.target.value)} className="min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg p-2 text-sm font-semibold" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted">Status</label>
                <SelectField value={cStatus} onChange={(v) => setCStatus(v as Project['status'])} options={STATUSES.map((s) => ({value: s, label: s}))} />
              </div>
            </div>
            <div className="mt-5 flex gap-2 border-t border-farm-accent-soft pt-4">
              <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
              <Button className="flex-1" onClick={() => void submit()} disabled={busy || !cName.trim()}>{busy ? 'Creating…' : 'Create Project'}</Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
