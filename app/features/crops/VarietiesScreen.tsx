// Crop Varieties (P2-M2). Belong to an Active category. List · search · create · edit · archive.
import {useMemo, useState} from 'react';
import {Controller, useForm} from 'react-hook-form';
import {offlineDB} from '../../core/offline/db';
import {usePermissions} from '../../core/permissions/permissions';
import {useSync} from '../../core/offline/sync';
import type {CropVariety} from '../../types/db';
import {varietyCreateSchema, varietyEditSchema, type VarietyCreateInput, type VarietyEditInput} from '../../schemas/crops';
import {Button, Card} from '../../components/ui';
import {Field, ReadOnlyField, TextInput, zodResolver} from '../../components/forms';
import {SelectField} from '../../components/overlay';
import {StatusBadge, useToast} from '../../components/feedback';
import {ArchiveButton, MasterDetail, useSyncedCrop} from './shared';
import {cropApi} from './api';

export default function VarietiesScreen() {
  const {companyId, has} = usePermissions();
  const {triggerSync} = useSync();
  const {notify} = useToast();
  const canManage = has('crop.manage');
  const {items, loaded} = useSyncedCrop(offlineDB.cropVarieties, companyId, cropApi.varieties.fetch);
  const {items: categories} = useSyncedCrop(offlineDB.cropCategories, companyId, cropApi.categories.fetch);
  const [selected, setSelected] = useState<string | 'new' | null>(null);
  const [query, setQuery] = useState('');
  const catName = useMemo(() => new Map((categories ?? []).map((c) => [c.id, c.name])), [categories]);
  const activeCats = (categories ?? []).filter((c) => c.status === 'Active').map((c) => ({value: c.id, label: c.name}));
  const current = selected && selected !== 'new' ? items?.find((v) => v.id === selected) : undefined;

  return (
    <MasterDetail
      title="Crop Varieties"
      subtitle="Specific crops within a category"
      newLabel="New variety"
      emptyTitle="No varieties yet"
      emptyHint="Create a category first, then add varieties under it."
      items={items}
      loaded={loaded}
      query={query}
      onQuery={setQuery}
      matches={(v, q) => v.name.toLowerCase().includes(q) || v.variety_code.toLowerCase().includes(q)}
      renderRow={(v) => (
        <>
          <span><span className="block text-lg font-semibold text-slate-800">{v.name}</span><span className="text-base text-slate-500">{catName.get(v.category_id) ?? '—'}</span></span>
          <span className="flex items-center gap-3"><span className="text-base text-slate-400">{v.variety_code}</span><StatusBadge status={v.status} /></span>
        </>
      )}
      selected={selected}
      onSelect={setSelected}
      canManage={canManage}
      detail={
        selected === 'new' ? (
          <CreateVariety companyId={companyId} categories={activeCats} onDone={() => {setSelected(null); triggerSync();}} notify={notify} />
        ) : current ? (
          <EditVariety row={current} parent={catName.get(current.category_id) ?? '—'} canManage={canManage} onDone={triggerSync} notify={notify} />
        ) : (
          <Card><p className="p-4 text-lg text-slate-500">Select a variety, or create one.</p></Card>
        )
      }
    />
  );
}

function CreateVariety({companyId, categories, onDone, notify}: {companyId: string | null; categories: Array<{value: string; label: string}>; onDone: () => void; notify: (m: string) => void}) {
  const {register, handleSubmit, control, formState: {errors, isSubmitting}} = useForm<VarietyCreateInput>({resolver: zodResolver(varietyCreateSchema)});
  return (
    <Card>
      <h2 className="mb-4 text-2xl font-bold">New variety</h2>
      {categories.length === 0 ? <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-base text-amber-900">Create an Active category first.</p> : null}
      <form className="space-y-4" onSubmit={handleSubmit(async (v) => {if (companyId) {await cropApi.varieties.create(companyId, v); notify('Variety queued'); onDone();}})}>
        <Field label="Category" error={errors.category_id?.message}><Controller control={control} name="category_id" render={({field}) => (<SelectField value={field.value} onChange={field.onChange} placeholder="Select category" options={categories} />)} /></Field>
        <Field label="Variety code" htmlFor="vc" error={errors.variety_code?.message}><TextInput id="vc" placeholder="LETTUCE" autoCapitalize="characters" {...register('variety_code')} /></Field>
        <Field label="Name" htmlFor="vn" error={errors.name?.message}><TextInput id="vn" placeholder="Lettuce" {...register('name')} /></Field>
        <Field label="Description" htmlFor="vd" error={errors.description?.message}><TextInput id="vd" placeholder="optional" {...register('description')} /></Field>
        <Button type="submit" disabled={isSubmitting || categories.length === 0}>Create variety</Button>
      </form>
    </Card>
  );
}

function EditVariety({row, parent, canManage, onDone, notify}: {row: CropVariety; parent: string; canManage: boolean; onDone: () => void; notify: (m: string) => void}) {
  const {register, handleSubmit, control, formState: {errors, isSubmitting}} = useForm<VarietyEditInput>({resolver: zodResolver(varietyEditSchema), defaultValues: {name: row.name, description: row.description ?? '', status: row.status}});
  return (
    <Card>
      <div className="mb-4 flex items-center justify-between"><h2 className="text-2xl font-bold">{row.name}</h2><StatusBadge status={row.status} /></div>
      <form className="space-y-4" onSubmit={handleSubmit(async (v) => {await cropApi.varieties.update(row, v); notify('Variety update queued'); onDone();})}>
        <ReadOnlyField label="Category" value={parent} note="Set at creation" />
        <ReadOnlyField label="Variety code" value={row.variety_code} />
        <Field label="Name" htmlFor="evn" error={errors.name?.message}><TextInput id="evn" disabled={!canManage} {...register('name')} /></Field>
        <Field label="Description" htmlFor="evd" error={errors.description?.message}><TextInput id="evd" disabled={!canManage} {...register('description')} /></Field>
        <Field label="Status" error={errors.status?.message}><Controller control={control} name="status" render={({field}) => (<SelectField value={field.value} onChange={field.onChange} options={[{value: 'Active', label: 'Active'}, {value: 'Archived', label: 'Archived'}]} />)} /></Field>
        <div className="flex gap-3">
          <Button type="submit" disabled={!canManage || isSubmitting}>Save</Button>
          {row.status === 'Active' ? <ArchiveButton disabled={!canManage} onArchive={async () => {await cropApi.varieties.archive(row); notify('Variety archived'); onDone();}} /> : null}
        </div>
      </form>
    </Card>
  );
}
