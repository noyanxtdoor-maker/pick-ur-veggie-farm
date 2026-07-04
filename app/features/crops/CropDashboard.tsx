// Crop dashboard (card-driven, M1C/inspiration). At-a-glance counts + quick actions into each crop screen.
import {useEffect} from 'react';
import {useNavigate} from 'react-router-dom';
import {useLiveQuery} from 'dexie-react-hooks';
import {FolderTree, Layers, Plus, Sprout, Tractor} from 'lucide-react';
import {offlineDB} from '../../core/offline/db';
import {usePermissions} from '../../core/permissions/permissions';
import {ActionTile, Card, PageHeader, StatCard} from '../../components/ui';
import {cropApi} from './api';

export default function CropDashboard() {
  const {companyId, has} = usePermissions();
  const navigate = useNavigate();
  const canManage = has('crop.manage');

  // Warm the local cache so the counts are populated (local-first; offline-safe).
  useEffect(() => {
    if (!companyId) return;
    cropApi.categories.fetch(companyId).then((r) => offlineDB.cropCategories.bulkPut(r)).catch(() => undefined);
    cropApi.varieties.fetch(companyId).then((r) => offlineDB.cropVarieties.bulkPut(r)).catch(() => undefined);
    cropApi.profiles.fetch(companyId).then((r) => offlineDB.cropProfiles.bulkPut(r)).catch(() => undefined);
    cropApi.templates.fetch(companyId).then((r) => offlineDB.plantingTemplates.bulkPut(r)).catch(() => undefined);
  }, [companyId]);

  const cats = useLiveQuery(async () => (companyId ? offlineDB.cropCategories.where('company_id').equals(companyId).count() : 0), [companyId], 0);
  const vars = useLiveQuery(async () => (companyId ? offlineDB.cropVarieties.where('company_id').equals(companyId).count() : 0), [companyId], 0);
  const profs = useLiveQuery(async () => (companyId ? offlineDB.cropProfiles.where('company_id').equals(companyId).count() : 0), [companyId], 0);
  const tmpls = useLiveQuery(async () => (companyId ? offlineDB.plantingTemplates.where('company_id').equals(companyId).count() : 0), [companyId], 0);

  return (
    <div>
      <PageHeader title="Crop Management" subtitle="Your crop catalog and planting plans" />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Categories" value={cats ?? 0} />
        <StatCard label="Varieties" value={vars ?? 0} />
        <StatCard label="Profiles" value={profs ?? 0} />
        <StatCard label="Planting templates" value={tmpls ?? 0} />
      </div>
      <Card>
        <h2 className="mb-3 text-xl font-bold">Quick actions</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <ActionTile label="Categories" icon={<FolderTree size={28} aria-hidden />} onClick={() => navigate('../categories')} />
          <ActionTile label="Varieties" icon={<Sprout size={28} aria-hidden />} onClick={() => navigate('../varieties')} />
          <ActionTile label="Profiles" icon={<Layers size={28} aria-hidden />} onClick={() => navigate('../profiles')} />
          <ActionTile label="Planting templates" icon={<Tractor size={28} aria-hidden />} onClick={() => navigate('../templates')} />
        </div>
        {canManage ? (
          <div className="mt-4">
            <ActionTile label="New category" icon={<Plus size={24} aria-hidden />} onClick={() => navigate('../categories')} />
          </div>
        ) : (
          <p className="mt-4 text-base text-farm-muted">You can view crops. Editing needs the crop.manage permission.</p>
        )}
      </Card>
    </div>
  );
}
