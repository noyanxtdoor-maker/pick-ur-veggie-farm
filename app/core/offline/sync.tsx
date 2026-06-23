// Sync provider (M1B O2). Drains the outbox on app-foreground + `online` events (reliable) — Background Sync
// API is intentionally NOT the driver (unreliable on field tablets). A single in-memory lock prevents
// concurrent drains. Pending/blocked counts are reactive via Dexie live queries.
import {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {useLiveQuery} from 'dexie-react-hooks';
import {offlineDB} from './db';
import {processOutbox} from './queue';
import {supabaseSender} from '../api/repository';
import {MOCK_MODE, mockSender} from '../mock/mock';

// Mock/offline-dev mode drains the outbox into Dexie (no network); real mode goes to Supabase.
const activeSender = MOCK_MODE ? mockSender : supabaseSender;

interface SyncValue {
  online: boolean;
  pending: number;
  blocked: number;
  syncing: boolean;
  triggerSync: () => void;
}

const Ctx = createContext<SyncValue | null>(null);

export function SyncProvider({children}: {children: ReactNode}) {
  const [online, setOnline] = useState<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [syncing, setSyncing] = useState(false);
  const lock = useRef(false);

  const pending = useLiveQuery(
    () => offlineDB.outbox.where('state').anyOf('Pending', 'Failed', 'Uploading').count(),
    [],
    0,
  );
  const blocked = useLiveQuery(() => offlineDB.outbox.where('state').equals('Blocked').count(), [], 0);

  const triggerSync = useCallback(() => {
    if (lock.current || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
    lock.current = true;
    setSyncing(true);
    processOutbox(activeSender)
      .catch(() => undefined)
      .finally(() => {
        lock.current = false;
        setSyncing(false);
      });
  }, []);

  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      triggerSync(); // O2 — resume on reconnect.
    };
    const goOffline = () => setOnline(false);
    const onFocus = () => triggerSync(); // O2 — resume on foreground.
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    window.addEventListener('focus', onFocus);
    triggerSync(); // O3 — re-drive any interrupted (Uploading/Pending) items on startup.
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('focus', onFocus);
    };
  }, [triggerSync]);

  const value = useMemo<SyncValue>(
    () => ({online, pending: pending ?? 0, blocked: blocked ?? 0, syncing, triggerSync}),
    [online, pending, blocked, syncing, triggerSync],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSync(): SyncValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSync must be used within <SyncProvider>');
  return v;
}
