// Crop Categories (P2-M2). List · search · create · edit · archive. Reuses AppShell/permissions/offline/state.
import {useState} from 'react';
import {Controller, useForm} from 'react-hook-form';
import {offlineDB} from '../../core/offline/db';
import {usePermissions} from '../../core/permissions/permissions';
import {useSync} from '../../core/offline/sync';
import type {CropCategory} from '../../types/db';
import {categoryCreateSchema, categoryEditSchema, type CategoryCreateInput, type CategoryEditInput} from '../../schemas/crops';
import {Button, Card} from '../../components/ui';
import {Field, ReadOnlyField, TextInput, zodResolver} from '../../components/forms';
import {SelectField} from '../../components/overlay';
import {StatusBadge, useToast} from '../../components/feedback';
import {ArchiveButton, MasterDetail, useSyncedCrop} from './shared';
import {cropApi} from './api';

export default function CategoriesScreen() {
  const {companyId, has} = usePermissions();
  const {triggerSync} = useSync();
  const {notify} = useToast();
  const canManage = has('crop.manage');
  const {items, loaded} = useSyncedCrop(offlineDB.cropCategories, companyId, cropApi.categories.fetch);
  const [selected, setSelected] = useState<string | 'new' | null>(null);
  const [query, setQuery] = useState('');
  const current = selected && selected !== 'new' ? items?.find((c) => c.id === selected) : undefined;

  return (
    <MasterDetail
      title="Crop Categories"
      subtitle="Top-level grouping for your crops"
      newLabel="New category"
      emptyTitle="No categories yet"
      emptyHint="Create your first crop category to organize varieties."
      items={items}
      loaded={loaded}
      query={query}
      onQuery={setQuery}
      matches={(c, q) => c.name.toLowerCase().includes(q) || c.category_code.toLowerCase().includes(q)}
      renderRow={(c) => (
        <>
          <span className="text-lg font-semibold text-slate-800">{c.name}</span>
          <span className="flex items-center gap-3"><span className="text-base text-slate-400">{c.category_code}</span><StatusBadge status={c.status} /></span>
        </>
      )}
      selected={selected}
      onSelect={setSelected}
      canManage={canManage}
      detail={
        selected === 'new' ? (
          <CreateCategory companyId={companyId} onDone={() => {setSelected(null); triggerSync();}} notify={notify} />
        ) : current ? (
          <EditCategory row={current} canManage={canManage} onDone={triggerSync} notify={notify} />
        ) : (
          <Card><p className="p-4 text-lg text-slate-500">Select a category, or create one.</p></Card>
        )
      }
    />
  );
}

function CreateCategory({companyId, onDone, notify}: {companyId: string | null; onDone: () => void; notify: (m: string) => void}) {
  const {register, handleSubmit, formState: {errors, isSubmitting}} = useForm<CategoryCreateInput>({resolver: zodResolver(categoryCreateSchema)});
  return (
    <Card>
      <h2 className="mb-4 text-2xl font-bold">New category</h2>
      <form className="space-y-4" onSubmit={handleSubmit(async (v) => {if (companyId) {await cropApi.categories.create(companyId, v); notify('Category queued'); onDone();}})}>
        <Field label="Category code" htmlFor="cc" error={errors.category_code?.message}><TextInput id="cc" placeholder="LEAFY" autoCapitalize="characters" {...register('category_code')} /></Field>
        <Field label="Name" htmlFor="cn" error={errors.name?.message}><TextInput id="cn" placeholder="Leafy greens" {...register('name')} /></Field>
        <Field label="Description" htmlFor="cd" error={errors.description?.message}><TextInput id="cd" placeholder="optional" {...register('description')} /></Field>
        <Button type="submit" disabled={isSubmitting}>Create category</Button>
      </form>
    </Card>
  );
}

function EditCategory({row, canManage, onDone, notify}: {row: CropCategory; canManage: boolean; onDone: () => void; notify: (m: string) => void}) {
  const {register, handleSubmit, control, formState: {errors, isSubmitting}} = useForm<CategoryEditInput>({
    resolver: zodResolver(categoryEditSchema),
    defaultValues: {name: row.name, description: row.description ?? '', status: row.status},
  });
  return (
    <Card>
      <div className="mb-4 flex items-center justify-between"><h2 className="text-2xl font-bold">{row.name}</h2><StatusBadge status={row.status} /></div>
      <form className="space-y-4" onSubmit={handleSubmit(async (v) => {await cropApi.categories.update(row, v); notify('Category update queued'); onDone();})}>
        <ReadOnlyField label="Category code" value={row.category_code} />
        <Field label="Name" htmlFor="en" error={errors.name?.message}><TextInput id="en" disabled={!canManage} {...register('name')} /></Field>
        <Field label="Description" htmlFor="ed" error={errors.description?.message}><TextInput id="ed" disabled={!canManage} {...register('description')} /></Field>
        <Field label="Status" error={errors.status?.message}>
          <Controller control={control} name="status" render={({field}) => (<SelectField value={field.value} onChange={field.onChange} options={[{value: 'Active', label: 'Active'}, {value: 'Archived', label: 'Archived'}]} />)} />
        </Field>
        <div className="flex gap-3">
          <Button type="submit" disabled={!canManage || isSubmitting}>Save</Button>
          {row.status === 'Active' ? <ArchiveButton disabled={!canManage} onArchive={async () => {await cropApi.categories.archive(row); notify('Category archived'); onDone();}} /> : null}
        </div>
        {!canManage ? <p className="text-base text-slate-500">Needs crop.manage to edit.</p> : null}
      </form>
    </Card>
  );
}
