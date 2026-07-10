// CAP-VG1 Step 3 — grounding without a model. Gathers today's events, open invoices, low stock (materials
// AND produce), and active projects from the SAME Dexie caches every screen reads — so the brief can only
// contain data this user was already allowed to load (spec §4: the Copilot runs under the user's
// permissions; reads-only, no server calls, no money-path surface). The rendered text doubles as the
// grounded context block for the model call (step 4). Structure adapted from Repo B's proven build
// (owner-authorized cross-repo lane), extended with produce stock.
import {offlineDB} from '../../core/offline/db';

export interface BriefSection {
  heading: string;
  items: string[];
}

export interface MorningBrief {
  date: string; // yyyy-mm-dd
  sections: BriefSection[];
  summary: string;
}

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const peso = (n: number) => `₱${n.toFixed(2)}`;

/** Gather the grounded brief from the local caches (all reads, all already user-scoped). */
export async function gatherBrief(companyId: string | null): Promise<MorningBrief> {
  const date = todayISO();
  const sections: BriefSection[] = [];
  if (!companyId) return {date, sections, summary: 'No company context — sign in first.'};

  // 1. today's calendar events
  const events = await offlineDB.calendarEvents.where('company_id').equals(companyId)
    .filter((e) => e.event_date === date && e.status !== 'Cancelled').toArray();
  if (events.length) {
    sections.push({
      heading: `Today's events (${events.length})`,
      items: events.map((e) => `${e.title}${e.start_time ? ` at ${e.start_time.slice(0, 5)}` : ' (all-day)'}${e.priority !== 'Normal' ? ` [${e.priority}]` : ''}`),
    });
  }

  // 2. open (unpaid) invoices = receivables to chase
  const unpaid = await offlineDB.posInvoices.where('company_id').equals(companyId)
    .filter((i) => i.status === 'Unpaid').toArray();
  if (unpaid.length) {
    const total = unpaid.reduce((s, i) => s + i.total, 0);
    sections.push({
      heading: `Open invoices (${unpaid.length} — ${peso(total)} outstanding)`,
      items: unpaid.map((i) => `#${i.invoice_number ?? 'pending'}: ${peso(i.total)}${i.note ? ` — ${i.note}` : ''}`),
    });
  }

  // 3a. low MATERIAL stock (heuristic threshold mirrors the dashboard's low-stock tile spirit)
  const matStock = await offlineDB.materialStock.where('company_id').equals(companyId).toArray();
  const lowMat = matStock.filter((s) => s.available < 10);
  if (lowMat.length) {
    const items = await offlineDB.inventoryItems.bulkGet([...new Set(lowMat.map((s) => s.item_id))]);
    const names = new Map(items.filter(Boolean).map((i) => [i!.id, i!.name]));
    sections.push({
      heading: `Low material stock (${lowMat.length})`,
      items: lowMat.map((s) => `${names.get(s.item_id) ?? s.item_id}: ${s.available} left`),
    });
  }

  // 3b. low PRODUCE stock (finished goods below 10 kg)
  const fg = await offlineDB.finishedGoods.where('company_id').equals(companyId)
    .filter((b) => b.status === 'Available' && b.available < 10).toArray();
  if (fg.length) {
    const prods = await offlineDB.products.bulkGet([...new Set(fg.map((b) => b.product_id))]);
    const names = new Map(prods.filter(Boolean).map((p) => [p!.id, p!.name]));
    sections.push({
      heading: `Low produce stock (${fg.length})`,
      items: fg.map((b) => `${names.get(b.product_id) ?? b.product_id}: ${b.available} kg left`),
    });
  }

  // 4. active projects
  const projects = await offlineDB.projects.where('company_id').equals(companyId)
    .filter((p) => p.status === 'In Progress').toArray();
  if (projects.length) {
    sections.push({
      heading: `Active projects (${projects.length})`,
      items: projects.map((p) => `${p.name}${p.end_date ? ` — finishes ${p.end_date}` : ''}`),
    });
  }

  const summary = sections.length
    ? sections.map((s) => s.heading).join(' · ')
    : 'No events, open invoices, or low-stock alerts today. The farm is running smoothly.';
  return {date, sections, summary};
}

/** Plain-text render — shown as the non-AI brief AND fed to the model as grounded context. */
export function renderBriefText(brief: MorningBrief): string {
  const lines = [`Morning Brief — ${brief.date}`, ''];
  if (!brief.sections.length) {
    lines.push(brief.summary);
    return lines.join('\n');
  }
  for (const s of brief.sections) {
    lines.push(s.heading);
    for (const it of s.items) lines.push(`  - ${it}`);
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}
