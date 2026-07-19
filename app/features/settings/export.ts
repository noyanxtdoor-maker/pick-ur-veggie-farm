// Local data export (P2 backlog B7, first slice) — a client-only, read-only JSON dump of THIS device's cache so
// the operator has a portable copy. No server call, no money, no new permission: it reads the user's own already-
// authorized local Dexie. assembleExport is pure so it can be tested without Dexie/DOM.
//
// Import (owner backlog item, 2026-07-19: "load a backup file back in — currently export-only, one way")
// deliberately stays scoped to the SAME boundary as export: THIS device's local Dexie cache, not the server.
// Dexie is a read-through CACHE of Supabase, not the source of truth — the next successful sync overwrites
// whatever was imported anyway, so importing into it is genuinely safe (worst case: stale cache until the
// next sync). A full RESTORE-TO-SERVER (re-inserting historical rows into Supabase from a JSON snapshot) is
// a materially different, much higher-risk feature — it would touch money-path append-only/balanced-posting
// invariants (C7 financial integrity) and needs its own governance decision, not a quiet client-side import.
// This module does not attempt that; importLocalData only ever writes to IndexedDB.
import {offlineDB} from '../../core/offline/db';

export interface ExportPayload {
  format: 'PickUrVeggieERP_Export';
  version: number;
  exportedAt: string;
  tables: Record<string, unknown[]>;
}

export function assembleExport(tableData: Record<string, unknown[]>, isoNow: string): ExportPayload {
  return {format: 'PickUrVeggieERP_Export', version: 3, exportedAt: isoNow, tables: tableData};
}

// The outbox is the internal write-ahead sync queue, not user data — and because it is deliberately preserved
// across logout (purgeCache keeps it so unsynced writes aren't lost), on a shared terminal it can still hold a
// previous operator's queued write payloads. Never include it in a user-facing "export my data" dump.
const EXPORT_EXCLUDE = new Set(['outbox']);

/** Gather every local DATA table into one JSON file and trigger a download. Returns the row count exported. */
export async function exportLocalData(): Promise<number> {
  const tableData: Record<string, unknown[]> = {};
  let rows = 0;
  for (const t of offlineDB.tables) {
    if (EXPORT_EXCLUDE.has(t.name)) continue;
    const data = await t.toArray();
    tableData[t.name] = data;
    rows += data.length;
  }
  const payload = assembleExport(tableData, new Date().toISOString());
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pickurveggie_export_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return rows;
}

export function parseImportFile(text: string): ExportPayload {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('Not a valid JSON file.'); }
  const p = parsed as Partial<ExportPayload>;
  if (p?.format !== 'PickUrVeggieERP_Export' || typeof p.tables !== 'object' || p.tables === null) {
    throw new Error('Not a PickUrVeggie export file.');
  }
  return p as ExportPayload;
}

/** Load a previously-exported JSON file back into THIS device's local cache (upsert, table-by-table —
 *  existing rows with a matching id are overwritten, everything else untouched). Local cache only; see
 *  the module header for why this deliberately does not write to the server. Returns the row count
 *  imported. Skips any table name the payload has that this build of the app no longer recognizes,
 *  rather than failing the whole import over one stale/renamed table. */
export async function importLocalData(payload: ExportPayload): Promise<number> {
  const knownTables = new Set(offlineDB.tables.map((t) => t.name));
  let rows = 0;
  await offlineDB.transaction('rw', offlineDB.tables, async () => {
    for (const [tableName, data] of Object.entries(payload.tables)) {
      if (tableName === 'outbox' || !knownTables.has(tableName) || !Array.isArray(data) || data.length === 0) continue;
      await offlineDB.table(tableName).bulkPut(data);
      rows += data.length;
    }
  });
  return rows;
}
