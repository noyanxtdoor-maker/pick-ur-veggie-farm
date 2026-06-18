import { db } from '../db';

export const ALL_TABLES = [
  'users',
  'prices',
  'transactions',
  'expenses',
  'equipment',
  'employees',
  'cashAdvances',
  'wages',
  'cashEntries',
  'scheduleEvents',
  'projects',
  'meta'
];

export function validateBackup(payload: any): boolean {
  if (!payload || payload.format !== 'PickUrVeggieERP_Backup') {
    return false;
  }
  if (!payload.tables || typeof payload.tables !== 'object') {
    return false;
  }
  return true;
}

export async function restoreFromData(payload: any): Promise<void> {
  if (!validateBackup(payload)) {
    throw new Error('Invalid backup file format');
  }

  // Use Dexie transaction to prevent partial wipes
  await db.transaction('rw', db.tables, async () => {
    for (const tableName of ALL_TABLES) {
      if (payload.tables[tableName]) {
        const table = db.table(tableName);
        await table.clear();
        if (payload.tables[tableName].length > 0) {
          await table.bulkAdd(payload.tables[tableName]);
        }
      }
    }
  });

  // Stamp last change to trigger UI refresh
  await db.meta.put({ key: 'lastChange', value: new Date().toISOString() });
}
