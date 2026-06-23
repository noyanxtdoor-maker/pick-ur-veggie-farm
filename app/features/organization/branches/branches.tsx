// Branches (M1C §8.4). Two-pane master/detail. Create + edit (name/status) gated by branch.manage; branch_code
// is immutable (ReadOnlyField). Writes go through the outbox (offline-safe); reads are local-first from Dexie.
import {useEffect, useState} from 'react';
import {Controller, useForm} from 'react-hook-form';
import {useLiveQuery} from 'dexie-react-hooks';
import {Plus} from 'lucide-react';
import {supabase} from '../../../core/supabase/client';
import {offlineDB} from '../../../core/offline/db';
import {enqueue} from '../../../core/offline/queue';
import {usePermissions} from '../../../core/permissions/permissions';
import {useSync} from '../../../core/offline/sync';
import type {Branch} from '../../../types/db';
import {branchCreateSchema, branchEditSchema, type BranchCreateInput, type BranchEditInput} from '../../../schemas/organization';
import {Button, Card, PageHeader, cn} from '../../../components/ui';
import {Field, ReadOnlyField, TextInput, zodResolver} from '../../../components/forms';
import {SelectField, ConfirmDialog} from '../../../components/overlay';
import {EmptyState, ErrorState, Skeleton, StatusBadge, useToast} from '../../../components/feedback';

const branchesApi = {
  async fetch(companyId: string): Promise<Branch[]> {
    const {data, error} = await supabase.from('branches').select('*').eq('company_id', companyId).order('branch_code');
    if (error) throw new Error(error.message);
    return (data ?? []) as Branch[];
  },
  create(companyId: string, input: BranchCreateInput) {
    return enqueue({companyId, kind: 'branch.create', request: {type: 'insert', table: 'branches', payload: {company_id: companyId, ...input}}});
  },
  update(branch: Branch, input: BranchEditInput) {
    return enqueue({
      companyId: branch.company_id,
      kind: 'branch.update',
      request: {type: 'update', table: 'branches', match: {id: branch.id, baseUpdatedAt: branch.updated_at}, payload: input},
    });
  },
};

export default function BranchesScreen() {
  const {companyId, has} = usePermissions();
  const {triggerSync} = useSync();
  const {notify} = useToast();
  const [selected, setSelected] = useState<string | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const canManage = has('branch.manage');

  const branches = useLiveQuery(
    async () => (companyId ? offlineDB.branches.where('company_id').equals(companyId).toArray() : []),
    [companyId],
  );

  useEffect(() => {
    if (!companyId) return;
    branchesApi
      .fetch(companyId)
      .then((rows) => offlineDB.branches.bulkPut(rows))
      .then(() => setError(null))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoaded(true));
  }, [companyId]);

  const current = selected && selected !== 'new' ? branches?.find((b) => b.id === selected) : undefined;

  return (
    <div>
      <PageHeader
        title="Branches"
        subtitle="Branches in your company"
        action={canManage ? <Button onClick={() => setSelected('new')}><Plus size={20} aria-hidden /> New branch</Button> : undefined}
      />
      <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
        <Card>
          {!loaded && !branches?.length ? (
            <Skeleton />
          ) : error && !branches?.length ? (
            <ErrorState message={error} onRetry={() => companyId && branchesApi.fetch(companyId).then((r) => offlineDB.branches.bulkPut(r))} />
          ) : branches && branches.length === 0 ? (
            <EmptyState title="No branches yet" hint="Create your first branch to start organizing operations." action={canManage ? <Button onClick={() => setSelected('new')}>Create branch</Button> : undefined} />
          ) : (
            <ul className="divide-y divide-slate-100">
              {branches?.map((b) => (
                <li key={b.id}>
                  <button onClick={() => setSelected(b.id)} className={cn('flex min-h-16 w-full items-center justify-between px-2 text-left', selected === b.id && 'bg-emerald-50')}>
                    <span className="text-lg font-semibold text-slate-800">{b.name}</span>
                    <span className="flex items-center gap-3"><span className="text-base text-slate-400">{b.branch_code}</span><StatusBadge status={b.status} /></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div>
          {selected === 'new' ? (
            <CreateBranch companyId={companyId} onDone={() => {setSelected(null); triggerSync();}} notify={notify} />
          ) : current ? (
            <EditBranch branch={current} canManage={canManage} onDone={() => triggerSync()} notify={notify} />
          ) : (
            <Card><p className="p-4 text-lg text-slate-500">Select a branch, or create a new one.</p></Card>
          )}
        </div>
      </div>
    </div>
  );
}

function CreateBranch({companyId, onDone, notify}: {companyId: string | null; onDone: () => void; notify: (m: string, k?: 'success' | 'error') => void}) {
  const {register, handleSubmit, formState: {errors, isSubmitting}} = useForm<BranchCreateInput>({resolver: zodResolver(branchCreateSchema)});
  return (
    <Card>
      <h2 className="mb-4 text-2xl font-bold">New branch</h2>
      <form
        className="space-y-4"
        onSubmit={handleSubmit(async (values) => {
          if (!companyId) return;
          await branchesApi.create(companyId, values); // O1 atomic enqueue before we report success
          notify('Branch queued — will sync when online');
          onDone();
        })}
      >
        <Field label="Branch code" htmlFor="bcode" error={errors.branch_code?.message}>
          <TextInput id="bcode" placeholder="BR-A2" autoCapitalize="characters" {...register('branch_code')} />
        </Field>
        <Field label="Name" htmlFor="bname" error={errors.name?.message}>
          <TextInput id="bname" placeholder="North Field" {...register('name')} />
        </Field>
        <Button type="submit" disabled={isSubmitting}>Create branch</Button>
      </form>
    </Card>
  );
}

function EditBranch({branch, canManage, onDone, notify}: {branch: Branch; canManage: boolean; onDone: () => void; notify: (m: string, k?: 'success' | 'error') => void}) {
  const {register, handleSubmit, control, formState: {errors, isSubmitting}} = useForm<BranchEditInput>({
    resolver: zodResolver(branchEditSchema),
    defaultValues: {name: branch.name, status: branch.status},
  });
  const [confirm, setConfirm] = useState<BranchEditInput | null>(null);

  return (
    <Card>
      <h2 className="mb-4 text-2xl font-bold">{branch.name}</h2>
      <form className="space-y-4" onSubmit={handleSubmit((v) => setConfirm(v))}>
        <ReadOnlyField label="Branch code" value={branch.branch_code} />
        <Field label="Name" htmlFor="ename" error={errors.name?.message}>
          <TextInput id="ename" disabled={!canManage} {...register('name')} />
        </Field>
        <Field label="Status" error={errors.status?.message}>
          <Controller
            control={control}
            name="status"
            render={({field}) => (
              <SelectField value={field.value} onChange={field.onChange} options={[{value: 'Active', label: 'Active'}, {value: 'Suspended', label: 'Suspended'}, {value: 'Archived', label: 'Archived'}]} />
            )}
          />
        </Field>
        <Button type="submit" disabled={!canManage || isSubmitting}>Save changes</Button>
        {!canManage ? <p className="text-base text-slate-500">You can view branches but need the branch.manage permission to edit.</p> : null}
      </form>
      <ConfirmDialog
        open={confirm !== null}
        title="Save branch changes?"
        description={confirm?.status === 'Suspended' ? 'Suspending a branch hides it from operations.' : 'Apply these changes to the branch.'}
        confirmLabel="Save"
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          if (confirm) {
            await branchesApi.update(branch, confirm);
            notify('Branch update queued');
          }
          setConfirm(null);
          onDone();
        }}
      />
    </Card>
  );
}
