// B.3 projects ↔ calendar — pure date-overlay logic (spans, single-date projects, due markers, % progress).
import {describe, expect, it} from 'vitest';
import {projectsOnDay, projectDueOn, projectPct} from '@/app/features/scheduling/projectOverlay';
import type {Project} from '@/app/types/db';

const proj = (over: Partial<Project>): Project => ({
  id: 'p1', company_id: 'c', branch_id: 'b', name: 'Tunnel retrofit', description: null,
  start_date: '2026-07-01', end_date: '2026-07-10', status: 'In Progress', visibility: 'Public',
  created_by: null, created_at: '', updated_at: '', tasks: [], ...over,
});

describe('projectsOnDay', () => {
  it('covers the whole [start, end] span inclusive', () => {
    const p = proj({});
    expect(projectsOnDay([p], '2026-07-01')).toHaveLength(1);
    expect(projectsOnDay([p], '2026-07-05')).toHaveLength(1);
    expect(projectsOnDay([p], '2026-07-10')).toHaveLength(1);
    expect(projectsOnDay([p], '2026-06-30')).toHaveLength(0);
    expect(projectsOnDay([p], '2026-07-11')).toHaveLength(0);
  });

  it('a single-dated project appears on that day only; undated never appears', () => {
    expect(projectsOnDay([proj({start_date: null})], '2026-07-10')).toHaveLength(1);
    expect(projectsOnDay([proj({start_date: null})], '2026-07-09')).toHaveLength(0);
    expect(projectsOnDay([proj({start_date: null, end_date: null})], '2026-07-05')).toHaveLength(0);
  });

  it('Completed projects drop off; On Hold stays visible', () => {
    expect(projectsOnDay([proj({status: 'Completed'})], '2026-07-05')).toHaveLength(0);
    expect(projectsOnDay([proj({status: 'On Hold'})], '2026-07-05')).toHaveLength(1);
  });
});

describe('projectDueOn / projectPct', () => {
  it('marks the finish day and computes checklist progress', () => {
    expect(projectDueOn(proj({}), '2026-07-10')).toBe(true);
    expect(projectDueOn(proj({}), '2026-07-09')).toBe(false);
    expect(projectDueOn(proj({status: 'Completed'}), '2026-07-10')).toBe(false);
    const tasks = [{completed: true}, {completed: true}, {completed: false}] as Project['tasks'];
    expect(projectPct(proj({tasks}))).toBe(67);
    expect(projectPct(proj({tasks: []}))).toBe(0);
  });
});
