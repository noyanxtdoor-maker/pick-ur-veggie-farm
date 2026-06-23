// Module placeholder for not-yet-built sections (Crops, Inventory, Operations, Reports, Settings).
// Keeps navigation whole; these modules arrive in later Phase-2 work.
import {PageHeader, Card} from '../components/ui';

export default function Placeholder({title}: {title: string}) {
  return (
    <div>
      <PageHeader title={title} />
      <Card>
        <p className="p-4 text-lg text-slate-500">{title} is part of a later Phase-2 module. The application shell, navigation, auth, offline queue, and Organization module are live now.</p>
      </Card>
    </div>
  );
}
