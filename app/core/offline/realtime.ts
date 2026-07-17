// Real-time refresh (P1K phase 1, owner request 2026-07-13: "no more manual refresh"). Subscribes to
// Postgres changes on the given tables and calls onChange whenever a row changes — so a screen like
// Approvals or the sales feed picks up ANOTHER session's write without a manual browser refresh. This is
// purely a "something changed, go refetch" nudge: it reuses each screen's own already-tested reload()
// rather than trying to hand-merge the changed row into the local cache. RLS on the underlying tables is
// still the real security boundary — Realtime only ever pushes a row change to a client that could
// already SELECT that row (see the P1K migration).
import {useEffect, useRef} from 'react';
import {supabase} from '../supabase/client';
import {MOCK_MODE} from '../mock/mock';

// `scoped: true` (the common case) filters to rows where company_id = the given companyId — only use
// `scoped: false` for a table that genuinely has no company_id column (e.g. `public.users`, which is a
// global identity table; a pending signup has no company yet by design, C2 §3). An unscoped subscription
// still can't leak DATA — the caller's own reload() re-fetch is RLS-gated exactly as it always was — it
// just means the refresh nudge itself isn't company-filtered for that one table.
export interface RealtimeWatch {
  table: string;
  scoped?: boolean;
}

export function useRealtimeRefresh(watches: readonly RealtimeWatch[], companyId: string | null | undefined, onChange: () => void): void {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const watchKey = watches.map((w) => `${w.table}:${w.scoped !== false}`).join(',');

  useEffect(() => {
    if (MOCK_MODE || !companyId) return;
    const channel = supabase.channel(`rt:${watchKey}:${companyId}`);
    for (const w of watches) {
      channel.on(
        'postgres_changes',
        w.scoped === false
          ? {event: '*', schema: 'public', table: w.table}
          : {event: '*', schema: 'public', table: w.table, filter: `company_id=eq.${companyId}`},
        () => onChangeRef.current(),
      );
    }
    channel.subscribe();
    return () => {void supabase.removeChannel(channel);};
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onChange delivered via ref; re-subscribing on every render would thrash the socket
  }, [watchKey, companyId]);
}
