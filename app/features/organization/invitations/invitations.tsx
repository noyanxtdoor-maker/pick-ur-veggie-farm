// Invitations (M1C §8.6). Create invitation via invite_user() RPC (ONLINE ONLY — non-idempotent, not queued;
// M1C §9), list + status. G2: there is no revoke_invitation function yet → the Revoke control is DISABLED with
// an honest note (no fake button). Expiration is automatic (server-enforced).
import {useEffect, useState} from 'react';
import {Controller, useForm} from 'react-hook-form';
import {useLiveQuery} from 'dexie-react-hooks';
import {Copy} from 'lucide-react';
import {supabase} from '../../../core/supabase/client';
import {offlineDB} from '../../../core/offline/db';
import {usePermissions} from '../../../core/permissions/permissions';
import {useSync} from '../../../core/offline/sync';
import {MOCK_MODE, mockRead} from '../../../core/mock/mock';
import {uuidv7} from '../../../core/offline/uuidv7';
import type {Invitation} from '../../../types/db';
import {inviteSchema, type InviteInput} from '../../../schemas/organization';
import {Button, Card, PageHeader} from '../../../components/ui';
import {Field, TextInput, zodResolver} from '../../../components/forms';
import {SelectField} from '../../../components/overlay';
import {EmptyState, Skeleton, StatusBadge, useToast} from '../../../components/feedback';

const invitationsApi = {
  async fetch(companyId: string): Promise<Invitation[]> {
    if (MOCK_MODE) return mockRead<Invitation>('invitations', companyId);
    const {data, error} = await supabase.from('invitations').select('*').eq('company_id', companyId).order('created_at', {ascending: false});
    if (error) throw new Error(error.message);
    return (data ?? []) as Invitation[];
  },
  async invite(companyId: string, input: InviteInput): Promise<string> {
    if (MOCK_MODE) {
      const token = `mock-token-${uuidv7()}`;
      const now = new Date().toISOString();
      await offlineDB.invitations.put({
        id: uuidv7(), company_id: companyId, branch_id: input.branch_id, role_id: input.role_id,
        email: input.email && input.email.length > 0 ? input.email : null, token, status: 'Pending',
        invited_by: 'demo', accepted_user_id: null,
        expires_at: new Date(Date.now() + input.valid_days * 86_400_000).toISOString(), created_at: now, updated_at: now,
      });
      return token;
    }
    const {data, error} = await supabase.rpc('invite_user', {
      p_company_id: companyId,
      p_branch_id: input.branch_id,
      p_role_id: input.role_id,
      p_email: input.email && input.email.length > 0 ? input.email : null,
      p_valid_days: input.valid_days,
    });
    if (error) throw new Error(error.message);
    return data as string;
  },
};

export default function InvitationsScreen() {
  const {companyId} = usePermissions();
  const {online} = useSync();
  const {notify} = useToast();
  const [loaded, setLoaded] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  const invitations = useLiveQuery(async () => (companyId ? offlineDB.invitations.where('company_id').equals(companyId).toArray() : []), [companyId]);
  const branches = useLiveQuery(async () => (companyId ? offlineDB.branches.where('company_id').equals(companyId).toArray() : []), [companyId]);
  const roles = useLiveQuery(async () => (companyId ? offlineDB.roles.where('company_id').equals(companyId).toArray() : []), [companyId]);

  const reload = () => {if (companyId) invitationsApi.fetch(companyId).then((r) => offlineDB.invitations.bulkPut(r)).catch(() => undefined).finally(() => setLoaded(true));};
  useEffect(reload, [companyId]);

  const {register, handleSubmit, control, reset, formState: {errors, isSubmitting}} = useForm<InviteInput>({
    resolver: zodResolver(inviteSchema),
    defaultValues: {valid_days: 7, email: ''},
  });

  return (
    <div>
      <PageHeader title="Invitations" subtitle="Invite people to your company" />
      <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <Card>
          {!loaded && !invitations?.length ? (
            <Skeleton />
          ) : invitations && invitations.length === 0 ? (
            <EmptyState title="No invitations yet" hint="Invite a user to grant them access to a branch and role." />
          ) : (
            <ul className="divide-y divide-farm-accent-soft">
              {invitations?.map((inv) => (
                <li key={inv.id} className="flex min-h-16 items-center justify-between px-2 py-2">
                  <span>
                    <span className="block text-lg font-semibold text-farm-ink">{inv.email ?? '(no email)'}</span>
                    <span className="text-base text-farm-muted">Expires {new Date(inv.expires_at).toLocaleDateString()}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <StatusBadge status={inv.status} />
                    {/* G2 — no revoke function yet. */}
                    <button disabled title="Revocation will be available in a future update." className="cursor-not-allowed rounded-lg px-3 py-1 text-sm font-semibold text-farm-accent">
                      Revoke
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="mb-4 text-2xl font-bold">Invite user</h2>
          {!online ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-base text-amber-900">Reconnect to send invitations (invitations are created online).</p>
          ) : null}
          <form
            className="space-y-4"
            onSubmit={handleSubmit(async (v) => {
              if (!companyId) return;
              try {
                const t = await invitationsApi.invite(companyId, v);
                setToken(t);
                notify('Invitation created');
                reset({valid_days: 7, email: '', branch_id: '', role_id: ''});
                reload();
              } catch (e) {
                notify(e instanceof Error ? e.message : 'Invite failed', 'error');
              }
            })}
          >
            <Field label="Branch" error={errors.branch_id?.message}>
              <Controller control={control} name="branch_id" render={({field}) => (
                <SelectField value={field.value} onChange={field.onChange} placeholder="Select branch" options={(branches ?? []).map((b) => ({value: b.id, label: b.name}))} />
              )} />
            </Field>
            <Field label="Role" error={errors.role_id?.message}>
              <Controller control={control} name="role_id" render={({field}) => (
                <SelectField value={field.value} onChange={field.onChange} placeholder="Select role" options={(roles ?? []).map((r) => ({value: r.id, label: r.role_key}))} />
              )} />
            </Field>
            <Field label="Email (optional)" htmlFor="iemail" error={errors.email?.message}><TextInput id="iemail" type="email" placeholder="person@example.com" {...register('email')} /></Field>
            <Field label="Expires in (days)" htmlFor="idays" error={errors.valid_days?.message}><TextInput id="idays" type="number" inputMode="numeric" min={1} max={30} {...register('valid_days')} /></Field>
            <Button type="submit" disabled={!online || isSubmitting}>Create invitation</Button>
          </form>

          {token ? (
            <div className="mt-4 rounded-xl border border-farm-accent bg-farm-accent-soft p-3">
              <p className="mb-2 text-base font-semibold text-farm-green">Invitation token — copy & share securely (delivered out of band):</p>
              <div className="flex items-center gap-2">
                <input readOnly value={token} className="min-h-12 flex-1 rounded-lg border border-farm-accent bg-farm-card px-3 font-mono text-sm" />
                <Button variant="secondary" onClick={() => {void navigator.clipboard?.writeText(token); notify('Token copied');}}><Copy size={18} aria-hidden /></Button>
              </div>
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
