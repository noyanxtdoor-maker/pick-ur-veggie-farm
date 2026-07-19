// Settings Hub (P2-M8) — the last core module. Prototype-parity for the parts that make sense in the V3
// server-backed app: a live THEME switcher (light/dark/cream/green — the prototype's 4 palettes) and a couple
// of per-device STATION preferences the shell reads back. Everything the prototype did against its local-only
// IndexedDB — Google-Drive sync, JSON export/import, factory reset — is deliberately backlog here (B7): in a
// multi-tenant server world those are governed server operations, not a client button. No migration, no new
// permission, no RLS surface: a device configuring its own look and labels.
import {useRef, useState} from 'react';
import {Palette, Check, Store, Cloud, Download, LogOut, MonitorCog, Sparkles, Upload} from 'lucide-react';
import {useSession} from '../../core/auth/session';
import {usePermissions} from '../../core/permissions/permissions';
import {Button, Card, PageHeader, cn} from '../../components/ui';
import {useToast} from '../../components/feedback';
import {ConfirmDialog} from '../../components/overlay';
import {THEMES, useTheme, usePref, type ThemeId} from '../../core/prefs/prefs';
import {exportLocalData, importLocalData, parseImportFile, type ExportPayload} from './export';

const THEME_META: Record<ThemeId, {name: string; desc: string; swatch: string}> = {
  light: {name: 'Fresh Wood', desc: 'Default deep forest-green daylight palette', swatch: '#003e1c'},
  dark: {name: 'Midnight Farm', desc: 'Calm sage on charcoal — easy on night eyes', swatch: '#7cb98f'},
  cream: {name: 'Warm Retro', desc: 'Cozy paper-white amber', swatch: '#d97706'},
  green: {name: 'Green Pastures', desc: 'Bright pasture green, minty daylight', swatch: '#1e7a3f'},
};

// The OTP-guarded password change (SecurityCard) MOVED to the Profile screen (P1L, ported from
// Team B f0249fa) alongside the new self-service username/email cards — Settings stays device-only.

// CAP-VG1 step 1 — the Copilot's LM Studio connection (D2 model choice is deliberately a preference,
// spec §7). Client state only; turning it off leaves the whole ERP untouched (spec §1 failure mode).
function CopilotCard() {
  const {notify} = useToast();
  const [enabled, setEnabled] = usePref('copilot_enabled', '1');
  const [lmUrl, setLmUrl] = usePref('copilot_lm_url', 'http://localhost:1234');
  const [model, setModel] = usePref('copilot_model', 'owner-default');
  return (
    <Card>
      <h3 className="mb-1 flex items-center gap-2 text-base font-bold text-farm-green"><Sparkles className="h-5 w-5" aria-hidden /> VeggieGenius Copilot</h3>
      <p className="mb-3 text-xs text-farm-muted">
        Connects the Copilot to a local LM Studio model on this device. Advisory only — it reads your data to
        answer questions and never writes anything. Switch it off and the ERP works exactly the same.
      </p>
      <div className="space-y-3 text-sm">
        <label className="flex min-h-10 cursor-pointer items-center gap-2 font-bold text-farm-ink">
          <input type="checkbox" checked={enabled === '1'} className="h-4 w-4 accent-farm-green"
            onChange={(e) => {setEnabled(e.target.checked ? '1' : '0'); notify(e.target.checked ? 'Copilot enabled' : 'Copilot off — ERP unaffected');}} />
          Enable Copilot
        </label>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="cp-url">LM Studio server URL</label>
          <input id="cp-url" value={lmUrl} onChange={(e) => setLmUrl(e.target.value)} placeholder="http://localhost:1234" className="min-h-11 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 font-mono text-xs" />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="cp-model">Model id <span className="normal-case text-farm-muted/70">(as shown in LM Studio)</span></label>
          <input id="cp-model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="e.g. google/gemma-3-4b" className="min-h-11 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 font-mono text-xs" />
        </div>
      </div>
    </Card>
  );
}

export default function SettingsScreen() {
  const {user, signOut} = useSession();
  const {has} = usePermissions();
  const {notify} = useToast();
  // P1L (ported from Team B, owner directive): the Data & Backup export is owner-tier only —
  // admin-and-below never see the card (not rendered, not merely disabled).
  const canBackup = has('company.manage');
  const [theme, setTheme] = useTheme();
  const [farmName, setFarmName] = usePref('farm_display_name');
  const [terminalId, setTerminalId] = usePref('terminal_id', 'Terminal A — Main Gate');
  const [receiptWidth, setReceiptWidth] = usePref('receipt_width', '80'); // '58' | '80' — thermal receipt paper width
  const [exporting, setExporting] = useState(false);

  async function doExport() {
    setExporting(true);
    try {
      const rows = await exportLocalData();
      notify(`Exported ${rows} records`);
    } catch (e) { notify(e instanceof Error ? e.message : 'Export failed', 'error'); } finally { setExporting(false); }
  }

  // Owner backlog item 2026-07-19: "load a backup file back in." Local-cache-only by design — see
  // export.ts's module header for why a full server restore is a separate, larger, governance-gated ask.
  const importInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [pendingImport, setPendingImport] = useState<ExportPayload | null>(null);

  async function onImportFileChosen(file: File) {
    try {
      const payload = parseImportFile(await file.text());
      setPendingImport(payload);
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not read that file', 'error'); }
    if (importInputRef.current) importInputRef.current.value = '';
  }

  async function confirmImport() {
    if (!pendingImport) return;
    setImporting(true);
    try {
      const rows = await importLocalData(pendingImport);
      notify(`Loaded ${rows} records into this device's local cache`);
    } catch (e) { notify(e instanceof Error ? e.message : 'Import failed', 'error'); }
    finally { setImporting(false); setPendingImport(null); }
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
            <div className="mt-4 border-t border-farm-accent-soft pt-4">
              <span className="mb-1.5 block text-[10px] font-bold uppercase text-farm-muted">Receipt paper width</span>
              <div className="flex gap-2" role="radiogroup" aria-label="Receipt paper width">
                {(['58', '80'] as const).map((w) => (
                  <button
                    key={w}
                    role="radio"
                    aria-checked={receiptWidth === w}
                    onClick={() => setReceiptWidth(w)}
                    className={cn(
                      'min-h-10 flex-1 rounded-lg border text-sm font-semibold transition',
                      receiptWidth === w ? 'border-farm-green bg-farm-accent-soft text-farm-green' : 'border-farm-accent-soft text-farm-muted hover:border-farm-accent',
                    )}
                  >
                    {w}mm
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[10px] text-farm-muted">Sizes the printed slip for a thermal receipt printer of this width. Set your printer driver's own paper size to match.</p>
            </div>
          </Card>

          {/* Data & backup — owner-tier only (P1L port: company.manage gate, owner directive) */}
          {canBackup ? (
            <Card>
              <h3 className="mb-1 flex items-center gap-2 text-base font-bold text-farm-green"><Cloud className="h-5 w-5" aria-hidden /> Data &amp; Backup</h3>
              <p className="mb-3 text-xs text-farm-muted">
                Your data lives in the company cloud and syncs automatically. You can also download a JSON copy of this
                device's records for your own safekeeping, or load one back in.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => void doExport()} disabled={exporting}><Download size={16} aria-hidden /> {exporting ? 'Exporting…' : 'Export my data (JSON)'}</Button>
                <Button variant="secondary" onClick={() => importInputRef.current?.click()} disabled={importing}><Upload size={16} aria-hidden /> Load backup file</Button>
                <input
                  ref={importInputRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(e) => {const f = e.target.files?.[0]; if (f) void onImportFileChosen(f);}}
                />
              </div>
              <p className="mt-2 text-[10px] text-farm-muted">
                Loading a backup only restores THIS device's local cache — not the company's cloud data. Useful for
                offline troubleshooting; the next successful sync will overwrite it with the live server data again.
              </p>
            </Card>
          ) : null}

          <ConfirmDialog
            open={pendingImport !== null}
            title="Load this backup file?"
            description={`This will overwrite matching records in ${terminalId || 'this device'}'s local cache (exported ${pendingImport?.exportedAt ? new Date(pendingImport.exportedAt).toLocaleString('en-PH') : 'unknown date'}). It does not change the company's cloud data — the next sync will refresh from the server again.`}
            confirmLabel={importing ? 'Loading…' : 'Load backup'}
            onCancel={() => setPendingImport(null)}
            onConfirm={confirmImport}
          />

          {/* VeggieGenius Copilot (CAP-VG1 step 1) — local LM Studio connection; pure client prefs, no DB. */}
          <CopilotCard />

          {/* Session */}
          <Card>
            <h3 className="mb-1 flex items-center gap-2 text-base font-bold text-farm-danger"><LogOut className="h-5 w-5" aria-hidden /> Session</h3>
            <p className="mb-3 text-xs text-farm-muted">
              Signed in as <strong className="font-mono text-farm-ink">{user?.email ?? 'operator'}</strong>.
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
