// Company settings (M1C §8.3). View profile; edit NAME only (company.manage). company_code / base_currency /
// status are immutable here (status is service_role-only — platform-managed, not owner self-service).
import {useEffect, useState} from 'react';
import {useForm} from 'react-hook-form';
import {useLiveQuery} from 'dexie-react-hooks';
import {supabase} from '../../../core/supabase/client';
import {offlineDB} from '../../../core/offline/db';
import {enqueue} from '../../../core/offline/queue';
import {usePermissions} from '../../../core/permissions/permissions';
import {useSync} from '../../../core/offline/sync';
import type {Company} from '../../../types/db';
import {companyEditSchema, type CompanyEditInput} from '../../../schemas/organization';
import {Button, Card, PageHeader} from '../../../components/ui';
import {Field, ReadOnlyField, TextInput, zodResolver} from '../../../components/forms';
import {ConfirmDialog} from '../../../components/overlay';
import {Skeleton, useToast} from '../../../components/feedback';

const companyApi = {
  async fetch(companyId: string): Promise<Company | null> {
    const {data, error} = await supabase.from('companies').select('*').eq('id', companyId).maybeSingle();
    if (error) throw new Error(error.message);
    return (data as Company | null) ?? null;
  },
  update(company: Company, input: CompanyEditInput) {
    return enqueue({
      companyId: company.id,
      kind: 'company.update',
      request: {type: 'update', table: 'companies', match: {id: company.id, baseUpdatedAt: company.updated_at}, payload: input},
    });
  },
};

export default function CompanyScreen() {
  const {companyId, has} = usePermissions();
  const {triggerSync} = useSync();
  const {notify} = useToast();
  const canManage = has('company.manage');
  const company = useLiveQuery(async () => (companyId ? offlineDB.companies.get(companyId) : undefined), [companyId]);

  useEffect(() => {
    if (!companyId) return;
    companyApi.fetch(companyId).then((c) => {if (c) void offlineDB.companies.put(c);}).catch(() => undefined);
  }, [companyId]);

  if (!company) return <Card><Skeleton rows={3} /></Card>;
  return <CompanyForm company={company} canManage={canManage} onSaved={triggerSync} notify={notify} />;
}

function CompanyForm({company, canManage, onSaved, notify}: {company: Company; canManage: boolean; onSaved: () => void; notify: (m: string) => void}) {
  const {register, handleSubmit, formState: {errors, isSubmitting}} = useForm<CompanyEditInput>({
    resolver: zodResolver(companyEditSchema),
    defaultValues: {name: company.name},
  });
  const [confirm, setConfirm] = useState<CompanyEditInput | null>(null);

  return (
    <div className="max-w-2xl">
      <PageHeader title="Company" subtitle="Your company profile" />
      <Card>
        <form className="space-y-4" onSubmit={handleSubmit((v) => setConfirm(v))}>
          <ReadOnlyField label="Company code" value={company.company_code} />
          <ReadOnlyField label="Base currency" value={company.base_currency_code} />
          <ReadOnlyField label="Status" value={company.status} note="Platform-managed" />
          <Field label="Company name" htmlFor="cname" error={errors.name?.message}>
            <TextInput id="cname" disabled={!canManage} {...register('name')} />
          </Field>
          <Button type="submit" disabled={!canManage || isSubmitting}>Save name</Button>
          {!canManage ? <p className="text-base text-slate-500">You need the company.manage permission to edit.</p> : null}
        </form>
      </Card>
      <ConfirmDialog
        open={confirm !== null}
        title="Save company name?"
        description="Update the company display name."
        confirmLabel="Save"
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          if (confirm) {
            await companyApi.update(company, confirm);
            notify('Company name update queued');
          }
          setConfirm(null);
          onSaved();
        }}
      />
    </div>
  );
}
