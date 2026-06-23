// Crop Profiles (P2-M2). Cultivation reference for a variety. List · search · create · edit · archive.
import {useMemo, useState} from 'react';
import {Controller, useForm} from 'react-hook-form';
import {offlineDB} from '../../core/offline/db';
import {usePermissions} from '../../core/permissions/permissions';
import {useSync} from '../../core/offline/sync';
import type {CropProfile} from '../../types/db';
import {profileCreateSchema, profileEditSchema, type ProfileCreateInput, type ProfileEditInput} from '../../schemas/crops';
import {Button, Card} from '../../components/ui';
import {Field, ReadOnlyField, TextInput, zodResolver} from '../../components/forms';
import {SelectField} from '../../components/overlay';
import {StatusBadge, useToast} from '../../components/feedback';
import {ArchiveButton, MasterDetail, useSyncedCrop} from './shared';
import {cropApi} from './api';

export default function ProfilesScreen() {
  const {companyId, has} = usePermissions();
  const {triggerSync} = useSync();
  const {notify} = useToast();
  const canManage = has('crop.manage');
  const {items, loaded} = useSyncedCrop(offlineDB.cropProfiles, companyId, cropApi.profiles.fetch);
  const {items: varieties} = useSyncedCrop(offlineDB.cropVarieties, companyId, cropApi.varieties.fetch);
  const [selected, setSelected] = useState<string | 'new' | null>(null);
  const [query, setQuery] = useState('');
  const varName = useMemo(() => new Map((varieties ?? []).map((v) => [v.id, v.name])), [varieties]);
  const activeVars = (varieties ?? []).filter((v) => v.status === 'Active').map((v) => ({value: v.id, label: v.name}));
  const current = selected && selected !== 'new' ? items?.find((p) => p.id === selected) : undefined;

  return (
    <MasterDetail
      title="Crop Profiles"
      subtitle="Cultivation details per variety"
      newLabel="New profile"
      emptyTitle="No profiles yet"
      emptyHint="Add a cultivation profile under a variety (e.g. growth duration)."
      items={items}
      loaded={loaded}
      query={query}
      onQuery={setQuery}
      matches={(p, q) => p.name.toLowerCase().includes(q) || p.profile_code.toLowerCase().includes(q)}
      renderRow={(p) => (
        <>
          <span><span className="block text-lg font-semibold text-slate-800">{p.name}</span><span className="text-base text-slate-500">{varName.get(p.variety_id) ?? '—'}{p.growth_duration_days ? ` · ${p.growth_duration_days}d` : ''}</span></span>
          <span className="flex items-center gap-3"><span className="text-base text-slate-400">{p.profile_code}</span><StatusBadge status={p.status} /></span>
        </>
      )}
      selected={selected}
      onSelect={setSelected}
      canManage={canManage}
      detail={
        selected === 'new' ? (
          <CreateProfile companyId={companyId} varieties={activeVars} onDone={() => {setSelected(null); triggerSync();}} notify={notify} />
        ) : current ? (
          <EditProfile row={current} parent={varName.get(current.variety_id) ?? '—'} canManage={canManage} onDone={triggerSync} notify={notify} />
        ) : (
          <Card><p className="p-4 text-lg text-slate-500">Select a profile, or create one.</p></Card>
        )
      }
    />
  );
}

function CreateProfile({companyId, varieties, onDone, notify}: {companyId: string | null; varieties: Array<{value: string; label: string}>; onDone: () => void; notify: (m: string) => void}) {
  const {register, handleSubmit, control, formState: {errors, isSubmitting}} = useForm<ProfileCreateInput>({resolver: zodResolver(profileCreateSchema)});
  return (
    <Card>
      <h2 className="mb-4 text-2xl font-bold">New profile</h2>
      {varieties.length === 0 ? <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-base text-amber-900">Create an Active variety first.</p> : null}
      <form className="space-y-4" onSubmit={handleSubmit(async (v) => {if (companyId) {await cropApi.profiles.create(companyId, v); notify('Profile queued'); onDone();}})}>
        <Field label="Variety" error={errors.variety_id?.message}><Controller control={control} name="variety_id" render={({field}) => (<SelectField value={field.value} onChange={field.onChange} placeholder="Select variety" options={varieties} />)} /></Field>
        <Field label="Profile code" htmlFor="pc" error={errors.profile_code?.message}><TextInput id="pc" placeholder="LET-STD" autoCapitalize="characters" {...register('profile_code')} /></Field>
        <Field label="Name" htmlFor="pn" error={errors.name?.message}><TextInput id="pn" placeholder="Standard lettuce" {...register('name')} /></Field>
        <Field label="Growth duration (days)" htmlFor="pg" error={errors.growth_duration_days?.message}><TextInput id="pg" type="number" inputMode="numeric" min={1} placeholder="optional" {...register('growth_duration_days')} /></Field>
        <Field label="Notes" htmlFor="pno" error={errors.notes?.message}><TextInput id="pno" placeholder="optional" {...register('notes')} /></Field>
        <Button type="submit" disabled={isSubmitting || varieties.length === 0}>Create profile</Button>
      </form>
    </Card>
  );
}

function EditProfile({row, parent, canManage, onDone, notify}: {row: CropProfile; parent: string; canManage: boolean; onDone: () => void; notify: (m: string) => void}) {
  const {register, handleSubmit, control, formState: {errors, isSubmitting}} = useForm<ProfileEditInput>({resolver: zodResolver(profileEditSchema), defaultValues: {name: row.name, growth_duration_days: row.growth_duration_days, notes: row.notes ?? '', status: row.status}});
  return (
    <Card>
      <div className="mb-4 flex items-center justify-between"><h2 className="text-2xl font-bold">{row.name}</h2><StatusBadge status={row.status} /></div>
      <form className="space-y-4" onSubmit={handleSubmit(async (v) => {await cropApi.profiles.update(row, v); notify('Profile update queued'); onDone();})}>
        <ReadOnlyField label="Variety" value={parent} note="Set at creation" />
        <ReadOnlyField label="Profile code" value={row.profile_code} />
        <Field label="Name" htmlFor="epn" error={errors.name?.message}><TextInput id="epn" disabled={!canManage} {...register('name')} /></Field>
        <Field label="Growth duration (days)" htmlFor="epg" error={errors.growth_duration_days?.message}><TextInput id="epg" type="number" inputMode="numeric" min={1} disabled={!canManage} {...register('growth_duration_days')} /></Field>
        <Field label="Notes" htmlFor="epno" error={errors.notes?.message}><TextInput id="epno" disabled={!canManage} {...register('notes')} /></Field>
        <Field label="Status" error={errors.status?.message}><Controller control={control} name="status" render={({field}) => (<SelectField value={field.value} onChange={field.onChange} options={[{value: 'Active', label: 'Active'}, {value: 'Archived', label: 'Archived'}]} />)} /></Field>
        <div className="flex gap-3">
          <Button type="submit" disabled={!canManage || isSubmitting}>Save</Button>
          {row.status === 'Active' ? <ArchiveButton disabled={!canManage} onArchive={async () => {await cropApi.profiles.archive(row); notify('Profile archived'); onDone();}} /> : null}
        </div>
      </form>
    </Card>
  );
}
