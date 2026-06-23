// Zod schemas for Crop Management (P2-M2). One schema = validation + types + offline provisional check (B5 §5).
import {z} from 'zod';

const codeSlug = z
  .string()
  .trim()
  .regex(/^[A-Z0-9][A-Z0-9-]{1,30}$/, 'Use 2–31 chars: A–Z, 0–9, dash; start alphanumeric.');
const name120 = z.string().trim().min(1, 'Required').max(120, 'Max 120 characters');
const optText = z.string().trim().max(500).optional().or(z.literal(''));
const status = z.enum(['Active', 'Archived']);
const optPositiveInt = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? null : v),
  z.coerce.number().int().positive('Must be a positive whole number').nullable(),
);

export const categoryCreateSchema = z.object({category_code: codeSlug, name: name120, description: optText});
export type CategoryCreateInput = z.infer<typeof categoryCreateSchema>;
export const categoryEditSchema = z.object({name: name120, description: optText, status});
export type CategoryEditInput = z.infer<typeof categoryEditSchema>;

export const varietyCreateSchema = z.object({category_id: z.string().uuid('Select a category'), variety_code: codeSlug, name: name120, description: optText});
export type VarietyCreateInput = z.infer<typeof varietyCreateSchema>;
export const varietyEditSchema = z.object({name: name120, description: optText, status});
export type VarietyEditInput = z.infer<typeof varietyEditSchema>;

export const profileCreateSchema = z.object({variety_id: z.string().uuid('Select a variety'), profile_code: codeSlug, name: name120, growth_duration_days: optPositiveInt, notes: optText});
export type ProfileCreateInput = z.infer<typeof profileCreateSchema>;
export const profileEditSchema = z.object({name: name120, growth_duration_days: optPositiveInt, notes: optText, status});
export type ProfileEditInput = z.infer<typeof profileEditSchema>;

export const templateCreateSchema = z.object({
  branch_id: z.string().uuid('Select a branch'),
  profile_id: z.string().uuid('Select a crop profile'),
  template_code: codeSlug,
  name: name120,
  season: optText,
  planned_quantity: z.coerce.number().int().min(0, 'Cannot be negative'),
});
export type TemplateCreateInput = z.infer<typeof templateCreateSchema>;
export const templateEditSchema = z.object({name: name120, season: optText, planned_quantity: z.coerce.number().int().min(0, 'Cannot be negative'), notes: optText, status});
export type TemplateEditInput = z.infer<typeof templateEditSchema>;
