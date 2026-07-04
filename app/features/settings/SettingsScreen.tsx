// Settings Hub (P2-M8) — the last core module. Prototype-parity for the parts that make sense in the V3
// server-backed app: a live THEME switcher (light/dark/cream/green — the prototype's 4 palettes) and a couple
// of per-device STATION preferences the shell reads back. Everything the prototype did against its local-only
// IndexedDB — Google-Drive sync, JSON export/import, factory reset — is deliberately backlog here (B7): in a
// multi-tenant server world those are governed server operations, not a client button. No migration, no new
// permission, no RLS surface: a device configuring its own look and labels.
import {useState} from 'react';
import {Palette, Check, Store, Cloud, Download, LogOut, MonitorCog} from 'lucide-react';
import {useSession} from '../../core/auth/session';
import {Button, Card, PageHeader, cn} from '../../components/ui';
import {useToast} from '../../components/feedback';
import {THEMES, useTheme, usePref, type ThemeId} from '../../core/prefs/prefs';
import {exportLocalData} from './export';

const THEME_META: Record<ThemeId, {name: string; desc: string; swatch: string}> = {
  light: {name: 'Fresh Wood', desc: 'Default deep forest-green daylight palette', swatch: '#003e1c'},
  dark: {name: 'Midnight Farm', desc: 'Calm sage on charcoal — easy on night eyes', swatch: '#7cb98f'},
  cream: {name: 'Warm Retro', desc: 'Cozy paper-white amber', swatch: '#d97706'},
  green: {name: 'Green Pastures', desc: 'Bright pasture green, minty daylight', swatch: '#1e7a3f'},
};

export default function SettingsScreen() {
  const {user, signOut} = useSession();
  const {notify} = useToast();
  const [theme, setTheme] = useTheme();
  const [farmName, setFarmName] = usePref('farm_display_name');
  const [terminalId, setTerminalId] = usePref('terminal_id', 'Terminal A — Main Gate');
  const [exporting, setExporting] = useState(false);

  async function doExport() {
    setExporting(true);
    try {
      const rows = await exportLocalData();
      notify(`Exported ${rows} records`);
    } catch (e) { notify(e instanceof Error ? e.message : 'Export failed', 'error'); } finally { setExporting(false); }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings Hub"
        subtitle="Personalize this device — pick a colour theme and label your register. Settings here stay on this device."
        action={<span className="rounded-full bg-farm-accent-soft px-3 py-1 text-[10px] font-black text-farm-green">STATION: {terminalId || '—'}</span>}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Appearance / theme */}
        <Card className="lg:col-span-1">
          <h3 className="mb-1 flex items-center gap-2 text-base font-bold text-farm-green"><Palette className="h-5 w-5" aria-hidden /> Appearance</h3>
          <p className="mb-4 text-xs text-farm-muted">Tailor the app for your screen — bright outdoor sun or cozy night shifts. Applies instantly.</p>
          <div className="space-y-2.5" role="radiogroup" aria-label="Theme">
            {THEMES.map((id) => {
              const m = THEME_META[id];
              const active = theme === id;
              return (
                <button
                  key={id}
                  role="radio"
                  aria-checked={active}
                  onClick={() => setTheme(id)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-xl border p-3 text-left transition',
                    active ? 'border-farm-green bg-farm-accent-soft ring-2 ring-farm-green' : 'border-farm-accent-soft hover:border-farm-accent',
                  )}
                >
                  <span className="h-9 w-9 shrink-0 rounded-lg shadow-sm" style={{backgroundColor: m.swatch}} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-xs font-extrabold text-farm-ink">{m.name} {active ? <Check className="h-3.5 w-3.5 text-farm-green" aria-hidden /> : null}</span>
                    <span className="mt-0.5 block text-[10px] text-farm-muted">{m.desc}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </Card>

        <div className="space-y-6 lg:col-span-2">
          {/* Station preferences */}
          <Card>
            <h3 className="mb-1 flex items-center gap-2 text-base font-bold text-farm-green"><MonitorCog className="h-5 w-5" aria-hidden /> Station</h3>
            <p className="mb-4 text-xs text-farm-muted">Labels this browser across the app header. Per-device — it does not change the company record.</p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[10px] font-bold uppercase text-farm-muted">Farm / branch display name</span>
                <input
                  value={farmName}
                  onChange={(e) => setFarmName(e.target.value)}
                  onBlur={() => notify('Saved')}
                  placeholder="(uses company name)"
                  className="min-h-11 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] font-bold uppercase text-farm-muted">Register / terminal ID</span>
                <input
                  value={terminalId}
                  onChange={(e) => setTerminalId(e.target.value)}
                  onBlur={() => notify('Saved')}
                  className="min-h-11 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm"
                />
              </label>
            </div>
            <p className="mt-3 text-[10px] text-farm-muted">Changes save as you type. Leave the display name blank to fall back to the company name.</p>
          </Card>

          {/* Data & backup — backlog */}
          <Card>
            <h3 className="mb-1 flex items-center gap-2 text-base font-bold text-farm-green"><Cloud className="h-5 w-5" aria-hidden /> Data &amp; Backup</h3>
            <p className="mb-3 text-xs text-farm-muted">
              Your data lives in the company cloud and syncs automatically. You can also download a JSON copy of this
              device's records for your own safekeeping. (Governed cloud backup + restore is a planned follow-up.)
            </p>
            <Button variant="secondary" onClick={() => void doExport()} disabled={exporting}><Download size={16} aria-hidden /> {exporting ? 'Exporting…' : 'Export my data (JSON)'}</Button>
          </Card>

          {/* Session */}
          <Card>
            <h3 className="mb-1 flex items-center gap-2 text-base font-bold text-farm-danger"><LogOut className="h-5 w-5" aria-hidden /> Session</h3>
            <p className="mb-3 text-xs text-farm-muted">
              Signed in as <strong className="font-mono text-farm-ink">{user?.email ?? 'operator'}</strong>. Sign-out is also in the top bar.
            </p>
            <Button variant="secondary" onClick={() => void signOut()}><LogOut size={16} aria-hidden /> Sign out</Button>
          </Card>
        </div>
      </div>

      <p className="flex items-center justify-center gap-1.5 text-center text-[10px] text-farm-muted">
        <Store className="h-3.5 w-3.5" aria-hidden /> PickUrVeggie ERP — device settings are stored locally in your browser.
      </p>
    </div>
  );
}
