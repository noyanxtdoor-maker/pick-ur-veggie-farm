// Real-mode reference-table hydration. Several screens (POS, Inventory, Approvals) need `branches` in the
// local Dexie cache to pick a default branch — but nothing pulls it down on login, only whichever screen a
// user happens to visit warms it as a side effect (ApprovalsScreen did this ad hoc; Branches screen too).
// A role scoped to just pos.sell has no reason to ever open Approvals or Branches, so on a fresh device
// their cache stays permanently empty and every branch-dependent screen spins forever (found live
// 2026-07-13). Call this once per screen mount instead of duplicating the fetch+bulkPut inline.
import {supabase} from '../supabase/client';
import {offlineDB} from './db';
import {MOCK_MODE} from '../mock/mock';

export function hydrateBranches(companyId: string): void {
  if (MOCK_MODE || !(typeof navigator === 'undefined' || navigator.onLine)) return;
  void Promise.resolve(supabase.from('branches').select('*').eq('company_id', companyId))
    .then(({data}) => {if (data) void offlineDB.branches.bulkPut(data as never[]);})
    .catch(() => undefined);
}
