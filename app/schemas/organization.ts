// Zod schemas — the single source of validation + types + offline provisional validation (M1B §6, B5 §5).
// Reused by React Hook Form (client) and as the typed write contract to the api layer.
import {z} from 'zod';

const codeSlug = z
  .string()
  .trim()
  .regex(/^[A-Z0-9][A-Z0-9-]{1,30}$/, 'Use 2–31 chars: A–Z, 0–9, dash; start alphanumeric.');

const name120 = z.string().trim().min(1, 'Required').max(120, 'Max 120 characters');

export const companyEditSchema = z.object({
  name: name120,
});
export type CompanyEditInput = z.infer<typeof companyEditSchema>;

export const branchCreateSchema = z.object({
  branch_code: codeSlug,
  name: name120,
});
export type BranchCreateInput = z.infer<typeof branchCreateSchema>;

export const branchEditSchema = z.object({
  name: name120,
  status: z.enum(['Active', 'Suspended', 'Archived']),
});
export type BranchEditInput = z.infer<typeof branchEditSchema>;

export const roleCreateSchema = z.object({
  role_key: codeSlug,
  description: name120,
});
export type RoleCreateInput = z.infer<typeof roleCreateSchema>;

export const roleEditSchema = z.object({
  description: name120,
  status: z.enum(['Active', 'Deprecated']),
});
export type RoleEditInput = z.infer<typeof roleEditSchema>;

export const inviteSchema = z.object({
  branch_id: z.string().uuid('Select a branch'),
  role_id: z.string().uuid('Select a role'),
  email: z.string().trim().email('Invalid email').optional().or(z.literal('')),
  valid_days: z.coerce.number().int().min(1, 'Min 1 day').max(30, 'Max 30 days'),
});
export type InviteInput = z.infer<typeof inviteSchema>;

export const membershipAssignSchema = z.object({
  user_id: z.string().uuid('Select a user'),
  branch_id: z.string().uuid('Select a branch'),
  role_id: z.string().uuid('Select a role'),
});
export type MembershipAssignInput = z.infer<typeof membershipAssignSchema>;

export const membershipEditSchema = z.object({
  // DB enum is Active|Expired only (M1C gap G3 — no "Suspended").
  assignment_status: z.enum(['Active', 'Expired']),
  expires_at: z.string().nullable(),
});
export type MembershipEditInput = z.infer<typeof membershipEditSchema>;
