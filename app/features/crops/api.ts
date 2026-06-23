// Crop data-access (M1B A1 seam). Reads via PostgREST (RLS/resolver enforce isolation); writes through the
// offline outbox (idempotent, optimistic-concurrency). Archive = a status update (no hard delete).
import {supabase} from '../../core/supabase/client';
import {enqueue} from '../../core/offline/queue';
import {MOCK_MODE, mockRead} from '../../core/mock/mock';
import {nz} from './shared';
import type {CropCategory, CropProfile, CropVariety, PlantingTemplate} from '../../types/db';
import type {CategoryCreateInput, CategoryEditInput, ProfileCreateInput, ProfileEditInput, TemplateCreateInput, TemplateEditInput, VarietyCreateInput, VarietyEditInput} from '../../schemas/crops';

async function fetchScoped<T>(table: string, companyId: string, order: string): Promise<T[]> {
  if (MOCK_MODE) return mockRead<T>(table, companyId);
  const {data, error} = await supabase.from(table).select('*').eq('company_id', companyId).order(order);
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}

const upd = (table: string, row: {id: string; company_id: string; updated_at: string}, kind: string, payload: Record<string, unknown>) =>
  enqueue({companyId: row.company_id, kind, request: {type: 'update', table, match: {id: row.id, baseUpdatedAt: row.updated_at}, payload}});

export const cropApi = {
  categories: {
    fetch: (c: string) => fetchScoped<CropCategory>('crop_categories', c, 'category_code'),
    create: (c: string, i: CategoryCreateInput) =>
      enqueue({companyId: c, kind: 'crop.category.create', request: {type: 'insert', table: 'crop_categories', payload: {company_id: c, category_code: i.category_code, name: i.name, description: nz(i.description)}}}),
    update: (row: CropCategory, i: CategoryEditInput) => upd('crop_categories', row, 'crop.category.update', {name: i.name, description: nz(i.description), status: i.status}),
    archive: (row: CropCategory) => upd('crop_categories', row, 'crop.category.archive', {status: 'Archived'}),
  },
  varieties: {
    fetch: (c: string) => fetchScoped<CropVariety>('crop_varieties', c, 'variety_code'),
    create: (c: string, i: VarietyCreateInput) =>
      enqueue({companyId: c, kind: 'crop.variety.create', request: {type: 'insert', table: 'crop_varieties', payload: {company_id: c, category_id: i.category_id, variety_code: i.variety_code, name: i.name, description: nz(i.description)}}}),
    update: (row: CropVariety, i: VarietyEditInput) => upd('crop_varieties', row, 'crop.variety.update', {name: i.name, description: nz(i.description), status: i.status}),
    archive: (row: CropVariety) => upd('crop_varieties', row, 'crop.variety.archive', {status: 'Archived'}),
  },
  profiles: {
    fetch: (c: string) => fetchScoped<CropProfile>('crop_profiles', c, 'profile_code'),
    create: (c: string, i: ProfileCreateInput) =>
      enqueue({companyId: c, kind: 'crop.profile.create', request: {type: 'insert', table: 'crop_profiles', payload: {company_id: c, variety_id: i.variety_id, profile_code: i.profile_code, name: i.name, growth_duration_days: i.growth_duration_days, notes: nz(i.notes)}}}),
    update: (row: CropProfile, i: ProfileEditInput) => upd('crop_profiles', row, 'crop.profile.update', {name: i.name, growth_duration_days: i.growth_duration_days, notes: nz(i.notes), status: i.status}),
    archive: (row: CropProfile) => upd('crop_profiles', row, 'crop.profile.archive', {status: 'Archived'}),
  },
  templates: {
    fetch: (c: string) => fetchScoped<PlantingTemplate>('planting_templates', c, 'template_code'),
    create: (c: string, i: TemplateCreateInput) =>
      enqueue({companyId: c, kind: 'crop.template.create', request: {type: 'insert', table: 'planting_templates', payload: {company_id: c, branch_id: i.branch_id, profile_id: i.profile_id, template_code: i.template_code, name: i.name, season: nz(i.season), planned_quantity: i.planned_quantity}}}),
    update: (row: PlantingTemplate, i: TemplateEditInput) => upd('planting_templates', row, 'crop.template.update', {name: i.name, season: nz(i.season), planned_quantity: i.planned_quantity, notes: nz(i.notes), status: i.status}),
    archive: (row: PlantingTemplate) => upd('planting_templates', row, 'crop.template.archive', {status: 'Archived'}),
  },
};
