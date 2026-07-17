// Module placeholder for not-yet-built sections (Reports — the only remaining user of this
// component; Crops was fully removed 2026-07-17). This is an honest "planned, not built" surface —
// do NOT fabricate report data. Show what's coming + point to where related live data already
// lives today. Ported from Team B (owner 2026-07-15/16).
import {Link} from 'react-router-dom';
import {BarChart3, ArrowRight} from 'lucide-react';
import {PageHeader, Card} from '../components/ui';

export default function Placeholder({title}: {title: string}) {
  const isReports = title === 'Reports';
  return (
    <div>
      <PageHeader title={title} />
      <Card>
        {isReports ? (
          <div className="p-6">
            <div className="mb-3 flex items-center gap-2 text-farm-green">
              <BarChart3 className="h-5 w-5" aria-hidden />
              <h2 className="text-lg font-bold">Reports — coming in a later module</h2>
            </div>
            <p className="mb-4 text-sm text-farm-muted">
              This section doesn't have data yet. Reports will pull from the live sales + ledger
              data and surface the summaries the owner needs (daily sales, best-selling vegetables,
              cash reconciliation, payroll totals, inventory turnover). It's planned Phase-2 work —
              not a bug, just not built. Nothing is hidden here.
            </p>
            <p className="mb-4 text-sm text-farm-muted">
              In the meantime, the live data those reports will summarize is already in:
            </p>
            <ul className="mb-4 space-y-2 text-sm">
              <li>
                <Link to="/dashboard" className="inline-flex items-center gap-1.5 font-bold text-farm-green hover:underline">
                  Dashboard <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
                <span className="text-farm-muted"> — today's sales, cash position, recent activity</span>
              </li>
              <li>
                <Link to="/accounting" className="inline-flex items-center gap-1.5 font-bold text-farm-green hover:underline">
                  Accounting <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
                <span className="text-farm-muted"> — the full ledger, journal entries, financial statements</span>
              </li>
              <li>
                <Link to="/pos" className="inline-flex items-center gap-1.5 font-bold text-farm-green hover:underline">
                  POS <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
                <span className="text-farm-muted"> — per-sale sales journal history</span>
              </li>
            </ul>
            <p className="text-[11px] text-farm-muted">
              When you're ready for Reports, tell the team which summary matters most first — daily
              sales, weekly veggie ranking, or monthly cash reconciliation — and that becomes spec
              for the first report.
            </p>
          </div>
        ) : (
          <p className="p-4 text-lg text-farm-muted">{title} is part of a later Phase-2 module. The application shell, navigation, auth, offline queue, and Organization module are live now.</p>
        )}
      </Card>
    </div>
  );
}
