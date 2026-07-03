// B7 export (first slice) — the pure payload assembler. The download IO in exportLocalData is a thin DOM wrapper.
import {describe, expect, it} from 'vitest';
import {assembleExport} from '@/app/features/settings/export';

describe('assembleExport', () => {
  it('wraps table data with a stable format + version + timestamp', () => {
    const p = assembleExport({customers: [{id: 'c1'}], meta: []}, '2026-07-03T00:00:00.000Z');
    expect(p.format).toBe('PickUrVeggieERP_Export');
    expect(p.version).toBe(3);
    expect(p.exportedAt).toBe('2026-07-03T00:00:00.000Z');
    expect(p.tables.customers).toHaveLength(1);
    expect(p.tables.meta).toEqual([]);
  });
});
