// Local data export (P2 backlog B7, first slice) — a client-only, read-only JSON dump of THIS device's cache so
// the operator has a portable copy. No server call, no money, no new permission: it reads the user's own already-
// authorized local Dexie. Restore/import + governed cloud backup are deliberately NOT here (import overwrites data
// → higher risk; that's the reviewed follow-up). assembleExport is pure so it can be tested without Dexie/DOM.
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

/** Gather every local table into one JSON file and trigger a download. Returns the row count exported. */
export async function exportLocalData(): Promise<number> {
  const tableData: Record<string, unknown[]> = {};
  let rows = 0;
  for (const t of offlineDB.tables) {
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
