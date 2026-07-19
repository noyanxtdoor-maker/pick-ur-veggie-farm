// B7 export (first slice) — the pure payload assembler. The download IO in exportLocalData is a thin DOM wrapper.
import {describe, expect, it} from 'vitest';
import {assembleExport, parseImportFile} from '@/app/features/settings/export';

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

describe('parseImportFile', () => {
  it('accepts a well-formed export payload', () => {
    const p = assembleExport({customers: [{id: 'c1'}]}, '2026-07-19T00:00:00.000Z');
    const parsed = parseImportFile(JSON.stringify(p));
    expect(parsed.tables.customers).toHaveLength(1);
  });

  it('rejects invalid JSON', () => {
    expect(() => parseImportFile('not json')).toThrow('Not a valid JSON file.');
  });

  it('rejects JSON that is not a PickUrVeggie export', () => {
    expect(() => parseImportFile(JSON.stringify({hello: 'world'}))).toThrow('Not a PickUrVeggie export file.');
  });

  it('rejects a payload with the wrong format tag', () => {
    expect(() => parseImportFile(JSON.stringify({format: 'SomeOtherApp_Export', tables: {}}))).toThrow('Not a PickUrVeggie export file.');
  });
});
