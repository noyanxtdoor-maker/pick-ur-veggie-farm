// Planting Templates (P2-M2) — the branch-owned operational entity. Visible/writable only for branches the user
// belongs to (server is_branch_member; the dropdown lists Active company branches, server enforces membership).
import {useMemo, useState} from 'react';
import {Controller, useForm} from 'react-hook-form';
import {supabase} from '../../core/supabase/client';
import {offlineDB} from '../../core/offline/db';
import {usePermissions} from '../../core/permissions/permissions';
import {useSync} from '../../core/offline/sync';
import type {Branch, PlantingTemplate} from '../../types/db';
import {templateCreateSchema, templateEditSchema, type TemplateCreateInput, type TemplateEditInput} from '../../schemas/crops';
import {Button, Card} from '../../components/ui';
import {Field, ReadOnlyField, TextInput, zodResolver} from '../../components/forms';
import {SelectField} from '../../components/overlay';
import {StatusBadge, useToast} from '../../components/feedback';
import {ArchiveButton, MasterDetail, useSyncedCrop} from './shared';
import {cropApi} from './api';

const branchFetch = async (c: string): Promise<Branch[]> => {
  const {data, error} = await supabase.from('branches').select('*').eq('company_id', c).order('branch_code');
  if (error) throw new Error(error.message);
  return (data ?? []) as Branch[];
};

export default function TemplatesScreen() {
  const {companyId, has} = usePermissions();
  const {triggerSync} = useSync();
  const {notify} = useToast();
  const canManage = has('crop.manage');
  const {items, loaded} = useSyncedCrop(offlineDB.plantingTemplates, companyId, cropApi.templates.fetch);
  const {items: profiles} = useSyncedCrop(offlineDB.cropProfiles, companyId, cropApi.profiles.fetch);
  const {items: branches} = useSyncedCrop(offlineDB.branches, companyId, branchFetch);
  const [selected, setSelected] = useState<string | 'new' | null>(null);
  const [query, setQuery] = useState('');
  const profName = useMemo(() => new Map((profiles ?? []).map((p) => [p.id, p.name])), [profiles]);
  const brName = useMemo(() => new Map((branches ?? []).map((b) => [b.id, b.name])), [branches]);
  const activeProfiles = (profiles ?? []).filter((p) => p.status === 'Active').map((p) => ({value: p.id, label: p.name}));
  const activeBranches = (branches ?? []).filter((b) => b.status === 'Active').map((b) => ({value: b.id, label: b.name}));
  const current = selected && selected !== 'new' ? items?.find((t) => t.id === selected) : undefined;

  return (
    <MasterDetail
      title="Planting Templates"
      subtitle="Reusable planting plans (per branch)"
      newLabel="New template"
      emptyTitle="No planting templates yet"
      emptyHint="Templates are specific to a branch — you see only the branches you belong to."
      items={items}
      loaded={loaded}
      query={query}
      onQuery={setQuery}
      matches={(t, q) => t.name.toLowerCase().includes(q) || t.template_code.toLowerCase().includes(q)}
      renderRow={(t) => (
        <>
          <span><span className="block text-lg font-semibold text-slate-800">{t.name}</span><span className="text-base text-slate-500">{profName.get(t.profile_id) ?? '—'} · {brName.get(t.branch_id) ?? 'branch'} · qty {t.planned_quantity}</span></span>
          <span className="flex items-center gap-3"><span className="text-base text-slate-400">{t.template_code}</span><StatusBadge status={t.status} /></span>
        </>
      )}
      selected={selected}
      onSelect={setSelected}
      canManage={canManage}
      detail={
        selected === 'new' ? (
          <CreateTemplate companyId={companyId} branches={activeBranches} profiles={activeProfiles} onDone={() => {setSelected(null); triggerSync();}} notify={notify} />
        ) : current ? (
          <EditTemplate row={current} branch={brName.get(current.branch_id) ?? '—'} profile={profName.get(current.profile_id) ?? '—'} canManage={canManage} onDone={triggerSync} notify={notify} />
        ) : (
          <Card><p className="p-4 text-lg text-slate-500">Select a template, or create one.</p></Card>
        )
      }
    />
  );
}

function CreateTemplate({companyId, branches, profiles, onDone, notify}: {companyId: string | null; branches: Array<{value: string; label: string}>; profiles: Array<{value: string; label: string}>; onDone: () => void; notify: (m: string) => void}) {
  const {register, handleSubmit, control, formState: {errors, isSubmitting}} = useForm<TemplateCreateInput>({resolver: zodResolver(templateCreateSchema), defaultValues: {planned_quantity: 0}});
  const blocked = branches.length === 0 || profiles.length === 0;
  return (
    <Card>
      <h2 className="mb-4 text-2xl font-bold">New planting template</h2>
      {blocked ? <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-base text-amber-900">Need an Active branch and an Active crop profile first.</p> : null}
      <form className="space-y-4" onSubmit={handleSubmit(async (v) => {if (companyId) {await cropApi.templates.create(companyId, v); notify('Template queued'); onDone();}})}>
        <Field label="Branch" error={errors.branch_id?.message}><Controller control={control} name="branch_id" render={({field}) => (<SelectField value={field.value} onChange={field.onChange} placeholder="Select branch" options={branches} />)} /></Field>
        <Field label="Crop profile" error={errors.profile_id?.message}><Controller control={control} name="profile_id" render={({field}) => (<SelectField value={field.value} onChange={field.onChange} placeholder="Select profile" options={profiles} />)} /></Field>
        <Field label="Template code" htmlFor="tc" error={errors.template_code?.message}><TextInput id="tc" placeholder="LET-A1" autoCapitalize="characters" {...register('template_code')} /></Field>
        <Field label="Name" htmlFor="tn" error={errors.name?.message}><TextInput id="tn" placeholder="Lettuce — Branch A1" {...register('name')} /></Field>
        <Field label="Season" htmlFor="ts" error={errors.season?.message}><TextInput id="ts" placeholder="optional (e.g. Dry)" {...register('season')} /></Field>
        <Field label="Planned quantity" htmlFor="tq" error={errors.planned_quantity?.message}><TextInput id="tq" type="number" inputMode="numeric" min={0} {...register('planned_quantity')} /></Field>
        <Button type="submit" disabled={isSubmitting || blocked}>Create template</Button>
      </form>
    </Card>
  );
}

function EditTemplate({row, branch, profile, canManage, onDone, notify}: {row: PlantingTemplate; branch: string; profile: string; canManage: boolean; onDone: () => void; notify: (m: string) => void}) {
  const {register, handleSubmit, control, formState: {errors, isSubmitting}} = useForm<TemplateEditInput>({resolver: zodResolver(templateEditSchema), defaultValues: {name: row.name, season: row.season ?? '', planned_quantity: row.planned_quantity, notes: row.notes ?? '', status: row.status}});
  return (
    <Card>
      <div className="mb-4 flex items-center justify-between"><h2 className="text-2xl font-bold">{row.name}</h2><StatusBadge status={row.status} /></div>
      <form className="space-y-4" onSubmit={handleSubmit(async (v) => {await cropApi.templates.update(row, v); notify('Template update queued'); onDone();})}>
        <ReadOnlyField label="Branch" value={branch} note="Set at creation" />
        <ReadOnlyField label="Crop profile" value={profile} note="Set at creation" />
        <ReadOnlyField label="Template code" value={row.template_code} />
        <Field label="Name" htmlFor="etn" error={errors.name?.message}><TextInput id="etn" disabled={!canManage} {...register('name')} /></Field>
        <Field label="Season" htmlFor="ets" error={errors.season?.message}><TextInput id="ets" disabled={!canManage} {...register('season')} /></Field>
        <Field label="Planned quantity" htmlFor="etq" error={errors.planned_quantity?.message}><TextInput id="etq" type="number" inputMode="numeric" min={0} disabled={!canManage} {...register('planned_quantity')} /></Field>
        <Field label="Notes" htmlFor="etno" error={errors.notes?.message}><TextInput id="etno" disabled={!canManage} {...register('notes')} /></Field>
        <Field label="Status" error={errors.status?.message}><Controller control={control} name="status" render={({field}) => (<SelectField value={field.value} onChange={field.onChange} options={[{value: 'Active', label: 'Active'}, {value: 'Archived', label: 'Archived'}]} />)} /></Field>
        <div className="flex gap-3">
          <Button type="submit" disabled={!canManage || isSubmitting}>Save</Button>
          {row.status === 'Active' ? <ArchiveButton disabled={!canManage} onArchive={async () => {await cropApi.templates.archive(row); notify('Template archived'); onDone();}} /> : null}
        </div>
      </form>
    </Card>
  );
}
