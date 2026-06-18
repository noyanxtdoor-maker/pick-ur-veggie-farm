import React, { useState, useEffect } from 'react';
import { db, seedDatabase } from '../db';
import { User } from '../lib/types';
import { 
  Settings as SettingsIcon, Palette, HardDrive, ShieldCheck, 
  Terminal, FileSpreadsheet, BadgePercent, Scale, FileJson, Trash2, 
  RefreshCw, Check, Activity, Cloud, CloudUpload, CloudDownload, CloudOff, Loader2, ArrowRight, LogOut
} from 'lucide-react';
import { 
  requestDriveAccessToken, 
  listDriveBackups, 
  uploadBackupToDrive, 
  downloadBackupFromDrive,
  DriveBackupFile
} from '../lib/drive';

interface SettingsProps {
  currentUser: User;
  onRefresh: () => void;
  onLogout?: () => void;
}

export function Settings({ currentUser, onRefresh, onLogout }: SettingsProps) {
  const handleLogoutClick = () => {
    if (confirm("Are you absolutely sure you want to sign out from Pick Ur Veggie ERP? This will terminate your current active session.")) {
      if (onLogout) {
        onLogout();
      }
    }
  };

  const [theme, setTheme] = useState<string>('light');
  const [farmName, setFarmName] = useState<string>('Pick Ur Veggie Farm');
  const [terminalId, setTerminalId] = useState<string>('Terminal A - Main Gate');
  const [receiptFooter, setReceiptFooter] = useState<string>('Thank you for choosing organic vegetables!');
  const [scaleSimulationMode, setScaleSimulationMode] = useState<string>('auto');
  const [vatRate, setVatRate] = useState<string>('exempt');
  const [defaultMarkup, setDefaultMarkup] = useState<string>('10');
  const [currencySymbol, setCurrencySymbol] = useState<string>('₱');

  // Google Drive connection states
  const [driveToken, setDriveToken] = useState<string | null>(() => {
    return sessionStorage.getItem('puv_drive_token') || null;
  });
  const [googleClientId, setGoogleClientId] = useState<string>(() => {
    return localStorage.getItem('puv_google_client_id') || '';
  });
  const [driveBackups, setDriveBackups] = useState<DriveBackupFile[]>([]);
  const [isLoadingBackups, setIsLoadingBackups] = useState<boolean>(false);
  const [isUploadingBackup, setIsUploadingBackup] = useState<boolean>(false);
  const [driveError, setDriveError] = useState<string | null>(null);
  
  // Database metrics state
  const [dbCounts, setDbCounts] = useState<{
    users: number;
    prices: number;
    transactions: number;
    expenses: number;
    equipment: number;
    employees: number;
  }>({
    users: 0,
    prices: 0,
    transactions: 0,
    expenses: 0,
    equipment: 0,
    employees: 0
  });

  const [savingField, setSavingField] = useState<string | null>(null);

  useEffect(() => {
    // Load local config
    const activeTheme = localStorage.getItem('puv_theme') || 'light';
    setTheme(activeTheme);

    const activeTerminal = localStorage.getItem('puv_terminal_id') || 'Terminal A - Main Gate';
    setTerminalId(activeTerminal);

    const activeFooter = localStorage.getItem('puv_receipt_footer') || 'Thank you for choosing organic vegetables!';
    setReceiptFooter(activeFooter);

    const activeScale = localStorage.getItem('puv_scale_sim') || 'auto';
    setScaleSimulationMode(activeScale);

    const activeVat = localStorage.getItem('puv_vat_rate') || 'exempt';
    setVatRate(activeVat);

    const activeMarkup = localStorage.getItem('puv_default_markup') || '10';
    setDefaultMarkup(activeMarkup);

    const activeCurrency = localStorage.getItem('puv_currency_symbol') || '₱';
    setCurrencySymbol(activeCurrency);

    const activeClientId = localStorage.getItem('puv_google_client_id') || '';
    setGoogleClientId(activeClientId);

    loadMetaAndMetrics();
  }, []);

  useEffect(() => {
    if (driveToken) {
      fetchDriveBackups();
    }
  }, [driveToken]);

  const fetchDriveBackups = async () => {
    if (!driveToken) return;
    setIsLoadingBackups(true);
    setDriveError(null);
    try {
      const files = await listDriveBackups(driveToken);
      setDriveBackups(files);
    } catch (err: any) {
      setDriveError(err.message || 'Failed to query backup list from Google Drive.');
      // If token expired or is 401, clear it dynamically
      if (err.message?.includes('401') || err.message?.includes('invalid')) {
        setDriveToken(null);
        sessionStorage.removeItem('puv_drive_token');
      }
    } finally {
      setIsLoadingBackups(false);
    }
  };

  const handleConnectDrive = async () => {
    const cid = googleClientId.trim();
    if (!cid) {
      alert('Please enter your Google OAuth Client ID first. You can get this from the Google Cloud Console (Credentials section).');
      return;
    }
    setDriveError(null);
    try {
      const token = await requestDriveAccessToken(cid);
      setDriveToken(token);
      sessionStorage.setItem('puv_drive_token', token);
      localStorage.setItem('puv_google_client_id', cid);
    } catch (err: any) {
      setDriveError(err.message || 'Google OAuth connection failed. Please verify your Client ID.');
    }
  };

  const handleDisconnectDrive = () => {
    setDriveToken(null);
    setDriveBackups([]);
    sessionStorage.removeItem('puv_drive_token');
  };

  const handleBackupToDrive = async () => {
    if (!driveToken) return;
    setIsUploadingBackup(true);
    setDriveError(null);
    try {
      const allTables = [
        'users', 'prices', 'transactions', 'expenses', 
        'equipment', 'employees', 'cashAdvances', 'wages', 
        'cashEntries', 'scheduleEvents', 'projects', 'meta'
      ];
      const payload: Record<string, any> = {
        format: 'PickUrVeggieERP_Backup',
        exportedAt: new Date().toISOString(),
        tables: {}
      };

      for (const t of allTables) {
        payload.tables[t] = await db.table(t).toArray();
      }

      const d = new Date();
      const timestamp = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}_${String(d.getUTCHours()).padStart(2, '0')}z`;
      const fileName = `pickurveggie_backup_${timestamp}.json`;

      await uploadBackupToDrive(driveToken, payload, fileName);
      alert('Secure backup file successfully written and synchronized into your Google Drive Storage folder!');
      
      // Update lastBackup metadata
      await db.meta.put({ key: 'lastBackup', value: new Date().toISOString() });
      await fetchDriveBackups();
      onRefresh();
    } catch (err: any) {
      setDriveError(err.message || 'Cloud backup upload failed.');
    } finally {
      setIsUploadingBackup(false);
    }
  };

  const handleRestoreFromDriveFile = async (fileId: string, fileName: string) => {
    if (!driveToken) return;
    if (!confirm(`Warning: Synchronizing and restoring from "${fileName}" will clear and replace all current local data with the backup's snapshot. Proceed?`)) {
      return;
    }

    try {
      const payload = await downloadBackupFromDrive(driveToken, fileId);
      
      if (!payload || payload.format !== 'PickUrVeggieERP_Backup') {
        alert('Format mismatch: Downloaded file is not identified as a valid PickUrVeggie ERP backup file.');
        return;
      }

      const allTables = [
        'users', 'prices', 'transactions', 'expenses', 
        'equipment', 'employees', 'cashAdvances', 'wages', 
        'cashEntries', 'scheduleEvents', 'projects', 'meta'
      ];

      await db.transaction('rw', db.tables, async () => {
        for (const tableName of allTables) {
          if (payload.tables[tableName]) {
            const table = db.table(tableName);
            await table.clear();
            if (payload.tables[tableName].length > 0) {
              await table.bulkAdd(payload.tables[tableName]);
            }
          }
        }
      });

      await db.meta.put({ key: 'lastChange', value: new Date().toISOString() });
      alert('ERP Local Database synchronized and restored successfully from Google Drive! Reloading app.');
      window.location.reload();
    } catch (err: any) {
      alert('Synchronization and download failed: ' + (err.message || err));
    }
  };

  const loadMetaAndMetrics = async () => {
    // Load from db.meta
    const metaFarm = await db.meta.get('farmName');
    if (metaFarm) {
      setFarmName(metaFarm.value);
    }

    // Load table counts
    const usersCount = await db.users.count();
    const pricesCount = await db.prices.count();
    const txnsCount = await db.transactions.count();
    const expCount = await db.expenses.count();
    const equipCount = await db.equipment.count();
    const empCount = await db.employees.count();

    setDbCounts({
      users: usersCount,
      prices: pricesCount,
      transactions: txnsCount,
      expenses: expCount,
      equipment: equipCount,
      employees: empCount
    });
  };

  const handleApplyTheme = (newTheme: string) => {
    setTheme(newTheme);
    localStorage.setItem('puv_theme', newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
    
    // dispatch event for active re-renders
    window.dispatchEvent(new Event('themechange'));
  };

  const handleSaveConfig = async (key: string, value: string, dbKey?: string) => {
    setSavingField(key);
    
    if (dbKey) {
      await db.meta.put({ key: dbKey, value });
    } else {
      localStorage.setItem(`puv_${key}`, value);
    }

    setTimeout(() => {
      setSavingField(null);
      onRefresh();
    }, 450);
  };

  // Export Entire Database as JSON Backups
  const handleExportDatabase = async () => {
    try {
      const backupData: Record<string, any[]> = {};
      
      const tables = ['users', 'prices', 'transactions', 'expenses', 'equipment', 'employees', 'cashAdvances', 'wages', 'cashEntries', 'scheduleEvents', 'projects', 'meta'];
      
      for (const t of tables) {
        const data = await (db as any)[t].toArray();
        backupData[t] = data;
      }

      const jsonStr = JSON.stringify(backupData, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `pickurveggie_backup_${new Date().toISOString().slice(0,10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('Failed to construct backup file: ' + err);
    }
  };

  // Import Database backup JSON
  const handleImportDatabase = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!confirm('WARNING: Importing a backup will overwrite existing local data. Proceed?')) {
      return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const rawJson = event.target?.result as string;
        const backupData = JSON.parse(rawJson);

        // Simple validation
        if (!backupData.users || !backupData.prices) {
          alert('Invalid backup schema file format.');
          return;
        }

        // Clear existing tables and add backup rows
        const tables = ['users', 'prices', 'transactions', 'expenses', 'equipment', 'employees', 'cashAdvances', 'wages', 'cashEntries', 'scheduleEvents', 'projects', 'meta'];
        for (const t of tables) {
          if (backupData[t]) {
            await (db as any)[t].clear();
            await (db as any)[t].bulkAdd(backupData[t]);
          }
        }

        alert('Database restored successfully from backup! App is reloading.');
        window.location.reload();
      } catch (err) {
        alert('Malformed backup file: ' + err);
      }
    };
    reader.readAsText(file);
  };

  // Direct Database reset to factory seeds
  const handleResetDatabase = async () => {
    const p1 = prompt('To confirm DELETION of all Transactions and custom Inventories, type: RESET DATABASE');
    if (p1 !== 'RESET DATABASE') {
      alert('Reset cancelled. Data remains safe.');
      return;
    }

    try {
      const tables = ['users', 'prices', 'transactions', 'expenses', 'equipment', 'employees', 'cashAdvances', 'wages', 'cashEntries', 'scheduleEvents', 'projects', 'meta'];
      for (const t of tables) {
        await (db as any)[t].clear();
      }

      await seedDatabase();
      alert('Database restored to original farm seeds! App will reload.');
      window.location.reload();
    } catch (err) {
      alert('Wipe failure: ' + err);
    }
  };

  const themesList = [
    { id: 'light', name: 'Fresh Wood', desc: 'Default forest-green palette', colorClass: 'bg-emerald-800' },
    { id: 'dark', name: 'Cosmic Mint', desc: 'Comfortable organic mint dark glow', colorClass: 'bg-emerald-300' },
    { id: 'cream', name: 'Warm Retro', desc: 'Cozy paper-white amber', colorClass: 'bg-amber-100' },
    { id: 'green', name: 'Green Pastures', desc: 'Rich organic minty color profile', colorClass: 'bg-emerald-600' }
  ];

  return (
    <div className="space-y-6 animate-fade-in max-w-6xl mx-auto">
      {/* Top Header */}
      <div className="bg-white rounded-2xl shadow-md border border-farm-accent-soft p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-black text-farm-green flex items-center gap-2">
            <SettingsIcon className="w-7 h-7" />
            <span>Universal ERP Configuration Hub</span>
          </h2>
          <p className="text-xs text-farm-muted mt-1 leading-relaxed">
            Personalize your terminal station, calibrate hardware feeds, select cohesive colors, and control cryptographic offline ledger backups.
          </p>
        </div>
        <div className="px-3 py-1.5 rounded-full bg-farm-accent-soft text-farm-green text-xs font-black font-mono">
          STATION: {terminalId}
        </div>
      </div>

      {/* Bento Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: Visual Theme Selector */}
        <div className="lg:col-span-1 bg-white rounded-2xl shadow-md border border-farm-accent-soft p-6 flex flex-col justify-between">
          <div>
            <h3 className="text-base font-bold text-farm-green flex items-center gap-2 mb-3">
              <Palette className="w-5 h-5" />
              <span>Cohesive Visual Styles</span>
            </h3>
            <p className="text-xs text-farm-muted leading-relaxed mb-6">
              Tailor the application visual balance for your screen conditions: outdoor direct sunlight or cozy night bookkeeping.
            </p>

            <div className="space-y-3">
              {themesList.map((t) => (
                <button
                  key={t.id}
                  onClick={() => handleApplyTheme(t.id)}
                  className={`w-full p-4 rounded-xl border text-left flex items-center gap-4 transition duration-200 cursor-pointer ${theme === t.id ? 'border-farm-green bg-farm-accent-soft ring-2 ring-farm-green' : 'border-stone-100 hover:border-farm-accent'}`}
                >
                  <div className={`w-10 h-10 rounded-lg ${t.colorClass} flex-shrink-0 flex items-center justify-center text-white font-bold text-lg select-none shadow-sm`}>
                    {t.name.slice(0, 1)}
                  </div>
                  <div className="flex-1">
                    <div className="font-extrabold text-xs text-farm-ink flex items-center gap-1.5">
                      <span>{t.name}</span>
                      {theme === t.id && (
                        <Check className="w-3.5 h-3.5 text-farm-green font-black" />
                      )}
                    </div>
                    <p className="text-[10px] text-farm-muted mt-0.5">{t.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-8 p-3 bg-farm-bg border border-farm-accent-soft rounded-xl text-[10px] text-farm-muted">
            Theme variables compile directly into Tailwind's v4 custom properties for hardware-accelerated transitions. No repaint lags.
          </div>
        </div>

        {/* Middle and Right Column: Bento Features Form Grid */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Station settings cards */}
          <div className="bg-white rounded-2xl shadow-md border border-farm-accent-soft p-6">
            <h3 className="text-base font-bold text-farm-green flex items-center gap-2 mb-4">
              <Terminal className="w-5 h-5" />
              <span>Hardware &amp; Branch Configurations</span>
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-semibold text-farm-ink">
              
              {/* Field 1: Custom Farm Name */}
              <div className="p-4 bg-farm-bg/50 border border-farm-accent-soft rounded-xl space-y-2">
                <label className="block text-[10px] uppercase font-bold text-farm-muted">Custom Farm / Branch Name</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={farmName}
                    onChange={(e) => setFarmName(e.target.value)}
                    className="flex-1 p-2 rounded border border-farm-accent bg-white outline-none"
                  />
                  <button
                    onClick={() => handleSaveConfig('farm_name', farmName, 'farmName')}
                    className="bg-farm-green hover:bg-farm-green-700 text-white font-bold p-2.5 rounded transition cursor-pointer flex items-center justify-center min-w-[70px]"
                  >
                    {savingField === 'farm_name' ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Apply'}
                  </button>
                </div>
              </div>

              {/* Field 2: Terminal Station Identifier */}
              <div className="p-4 bg-farm-bg/50 border border-farm-accent-soft rounded-xl space-y-2">
                <label className="block text-[10px] uppercase font-bold text-farm-muted">Register Terminal ID</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={terminalId}
                    onChange={(e) => setTerminalId(e.target.value)}
                    className="flex-1 p-2 rounded border border-farm-accent bg-white outline-none"
                  />
                  <button
                    onClick={() => handleSaveConfig('terminal_id', terminalId)}
                    className="bg-farm-green hover:bg-farm-green-700 text-white font-bold p-2.5 rounded transition cursor-pointer flex items-center justify-center min-w-[70px]"
                  >
                    {savingField === 'terminal_id' ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Save'}
                  </button>
                </div>
              </div>

              {/* Field 3: Receipt Footer Customization */}
              <div className="p-4 bg-farm-bg/50 border border-farm-accent-soft rounded-xl col-span-1 md:col-span-2 space-y-2">
                <label className="block text-[10px] uppercase font-bold text-farm-muted">Bottom Note on Slips / Receipts</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={receiptFooter}
                    onChange={(e) => setReceiptFooter(e.target.value)}
                    className="flex-1 p-2.5 rounded border border-farm-accent bg-white outline-none font-sans"
                  />
                  <button
                    onClick={() => handleSaveConfig('receipt_footer', receiptFooter)}
                    className="bg-farm-green hover:bg-farm-green-700 text-white font-bold p-3 rounded transition cursor-pointer flex items-center justify-center min-w-[80px]"
                  >
                    {savingField === 'receipt_footer' ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Update Text'}
                  </button>
                </div>
              </div>

              {/* Field 4: Weigh Scale Calibration mode */}
              <div className="p-4 bg-farm-bg/50 border border-farm-accent-soft rounded-xl space-y-2">
                <label className="block text-[10px] uppercase font-bold text-farm-muted flex justify-between">
                  <span>Weigh-scale Input Feed</span>
                  <Scale className="w-3.5 h-3.5" />
                </label>
                <select
                  value={scaleSimulationMode}
                  onChange={(e) => {
                    setScaleSimulationMode(e.target.value);
                    handleSaveConfig('scale_sim', e.target.value);
                  }}
                  className="w-full p-2 rounded border border-farm-accent bg-white outline-none text-xs font-semibold focus:outline-none"
                >
                  <option value="auto">Auto-calibration: Simulates digital scale</option>
                  <option value="manual">Manual keypad only, bypass scale checks</option>
                </select>
                <p className="text-[9px] text-farm-muted leading-tight mt-1">
                  Enables smart weights reading by simulating random basket weights from harvest beds.
                </p>
              </div>

              {/* Field 5: VAT Taxation Rule */}
              <div className="p-4 bg-farm-bg/50 border border-farm-accent-soft rounded-xl space-y-2">
                <label className="block text-[10px] uppercase font-bold text-farm-muted flex justify-between">
                  <span>Local VAT / Agri Tax Level</span>
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                </label>
                <select
                  value={vatRate}
                  onChange={(e) => {
                    setVatRate(e.target.value);
                    handleSaveConfig('vat_rate', e.target.value);
                  }}
                  className="w-full p-2 rounded border border-farm-accent bg-white outline-none text-xs font-semibold focus:outline-none"
                >
                  <option value="exempt">Raw Agricultural Crop VAT Exempt</option>
                  <option value="zero_rated">Zero-Rated Export (0%)</option>
                  <option value="full_12">Standard Retail Goods Value Tax (12%)</option>
                </select>
                <p className="text-[9px] text-farm-muted leading-tight mt-1">
                  Controls tax brackets on printed invoice outputs conforming to Bureau of Internal Revenue guidelines.
                </p>
              </div>

              {/* Field 6: Multi-tier Currency customization */}
              <div className="p-4 bg-farm-bg/50 border border-farm-accent-soft rounded-xl space-y-2">
                <label className="block text-[10px] uppercase font-bold text-farm-muted">Active Currency Formatting</label>
                <select
                  value={currencySymbol}
                  onChange={(e) => {
                    setCurrencySymbol(e.target.value);
                    handleSaveConfig('currency_symbol', e.target.value);
                  }}
                  className="w-full p-2 rounded border border-farm-accent bg-white outline-none text-xs font-semibold focus:outline-none"
                >
                  <option value="₱">₱ (Ph Peso - Default)</option>
                  <option value="$">$ (US Dollar / Co-Op Rates)</option>
                  <option value="€">€ (Euro rates)</option>
                </select>
              </div>

              {/* Field 7: Default wholesale discount percent */}
              <div className="p-4 bg-farm-bg/50 border border-farm-accent-soft rounded-xl space-y-2">
                <label className="block text-[10px] uppercase font-bold text-farm-muted">Standard Wholesale Discount</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={defaultMarkup}
                    onChange={(e) => setDefaultMarkup(e.target.value)}
                    className="flex-1 p-2 rounded border border-farm-accent bg-white outline-none"
                  />
                  <button
                    onClick={() => handleSaveConfig('default_markup', defaultMarkup)}
                    className="bg-farm-green hover:bg-farm-green-700 text-white font-bold p-2 px-3 rounded transition cursor-pointer"
                  >
                    Lock
                  </button>
                </div>
              </div>

            </div>
          </div>

          {/* Cloud backup center: Google Drive */}
          <div className="bg-white rounded-2xl shadow-md border border-farm-accent-soft p-6">
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-base font-bold text-farm-green flex items-center gap-2">
                <Cloud className="w-5 h-5 text-farm-green" />
                <span>Google Drive Cloud Synch System</span>
              </h3>
              {driveToken && (
                <button
                  onClick={handleDisconnectDrive}
                  className="text-xs font-bold text-red-500 hover:text-red-700 uppercase tracking-wider cursor-pointer border border-red-200 hover:bg-red-50 px-2.5 py-1 rounded-lg transition"
                >
                  Unlink Account
                </button>
              )}
            </div>

            {driveError && (
              <div className="p-3 mb-4 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl text-xs font-semibold leading-relaxed">
                🚨 {driveError}
              </div>
            )}

            {!driveToken ? (
              <div className="space-y-4">
                <p className="text-xs text-farm-muted leading-relaxed">
                  Secure your farm logs! Establish a real-time bridge with Google Drive to directly upload offline ledger databases, view revisions, and synchronize data safely across devices.
                </p>

                <div className="p-4 bg-farm-bg/50 border border-farm-accent-soft rounded-xl space-y-2">
                  <label className="block text-[10px] uppercase font-bold text-farm-muted">Google OAuth 2.0 Web Client ID</label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      value={googleClientId}
                      onChange={(e) => setGoogleClientId(e.target.value)}
                      placeholder="your-client-id.apps.googleusercontent.com"
                      className="flex-1 text-xs p-2.5 rounded-xl border border-farm-accent bg-white outline-none font-mono"
                    />
                    <button
                      onClick={handleConnectDrive}
                      className="bg-farm-green hover:bg-farm-green-700 text-white font-bold h-10 px-5 rounded-xl transition text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-sm uppercase tracking-wider"
                    >
                      <Cloud className="w-4 h-4" /> Link Drive
                    </button>
                  </div>
                </div>

                <div className="text-[10px] text-farm-muted bg-stone-50 border border-stone-200 p-3 rounded-xl space-y-1">
                  <span className="font-bold uppercase text-[9px] text-farm-green block">🚀 Quick Connection Tutorial:</span>
                  <p className="font-semibold leading-normal">
                    1. Open the <strong>Google Cloud Console</strong> &rarr; Credentials page.<br />
                    2. Generate an <strong>OAuth 2.0 Client ID</strong> for Web applications.<br />
                    3. Add this URI to Authorized JavaScript Origins: <strong className="font-mono text-farm-green">{window.location.origin}</strong><br />
                    4. Paste your Client ID above and link your Drive securely in seconds!
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4 animate-fade-in">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl">
                  <div>
                    <span className="text-[9px] bg-emerald-100 text-emerald-800 font-black rounded px-1.5 py-0.5 uppercase">Status: Connected</span>
                    <p className="text-xs font-semibold text-emerald-950 mt-1">Ready to manage cloud backup ledger files directly inside your Drive.</p>
                  </div>
                  <button
                    onClick={handleBackupToDrive}
                    disabled={isUploadingBackup}
                    className="bg-farm-green hover:bg-farm-green-700 disabled:opacity-50 text-white font-extrabold h-9 px-4 rounded-lg flex items-center justify-center gap-1 text-[11px] uppercase tracking-wider cursor-pointer shadow-xs"
                  >
                    {isUploadingBackup ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <CloudUpload className="w-3.5 h-3.5" />
                    )}
                    <span>Upload Current Snapshot</span>
                  </button>
                </div>

                <div>
                  <h4 className="text-xs font-bold text-farm-muted uppercase mb-2 flex items-center gap-1.5">
                    <CloudDownload className="w-4 h-4 text-farm-green" />
                    <span>Google Drive Synced Snapshots</span>
                  </h4>

                  {isLoadingBackups ? (
                    <div className="py-8 text-center text-xs text-farm-muted flex flex-col items-center justify-center gap-2 bg-farm-bg rounded-xl border border-dashed border-farm-accent">
                      <Loader2 className="w-6 h-6 animate-spin text-farm-green" />
                      <span>Loading snapshots index...</span>
                    </div>
                  ) : driveBackups.length > 0 ? (
                    <div className="max-h-56 overflow-y-auto border border-farm-accent-soft rounded-xl divide-y divide-farm-accent-soft bg-white">
                      {driveBackups.map((f) => (
                        <div key={f.id} className="p-3 text-xs flex justify-between items-center hover:bg-farm-bg transition gap-4">
                          <div className="min-w-0 flex-1">
                            <p className="font-bold text-farm-ink truncate font-mono text-[11px]" title={f.name}>📂 {f.name}</p>
                            <p className="text-[10px] text-stone-400 mt-0.5">Created on: {new Date(f.createdTime).toLocaleString()} {f.size ? `• ${Math.round(parseInt(f.size)/1024)} KB` : ''}</p>
                          </div>
                          <button
                            onClick={() => handleRestoreFromDriveFile(f.id, f.name)}
                            className="bg-sky-50 text-sky-700 hover:bg-sky-100 border border-sky-200 font-bold px-3 py-1.5 rounded-lg text-[10px] uppercase cursor-pointer transition flex items-center gap-1"
                          >
                            <RefreshCw className="w-3 h-3" /> Sync Load
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="py-8 text-center text-xs text-farm-muted bg-farm-bg rounded-xl border border-dashed border-farm-accent flex flex-col items-center justify-center p-4">
                      <CloudOff className="w-8 h-8 text-farm-accent mb-2" />
                      <p className="font-semibold text-farm-green">No PickUrVeggie snapshots found.</p>
                      <p className="text-[10px] text-farm-muted mt-0.5">Click "Upload Current Snapshot" above to commit your first sync ledger file.</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Database & backup admin tools */}
          <div className="bg-white rounded-2xl shadow-md border border-farm-accent-soft p-6">
            <h3 className="text-base font-bold text-farm-green flex items-center gap-2 mb-4">
              <HardDrive className="w-5 h-5" />
              <span>Offline Database Maintenance &amp; Backup Security</span>
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              
              {/* Counts Bento Block 1 */}
              <div className="p-3 bg-stone-50 border border-stone-100 rounded-xl text-center">
                <div className="text-stone-400 font-bold uppercase text-[9px] tracking-wide">Sales Slips Booked</div>
                <div className="text-xl font-bold font-mono text-farm-ink mt-0.5">{dbCounts.transactions}</div>
              </div>

              {/* Counts Bento Block 2 */}
              <div className="p-3 bg-stone-50 border border-stone-100 rounded-xl text-center">
                <div className="text-stone-400 font-bold uppercase text-[9px] tracking-wide">Expense Purchase items</div>
                <div className="text-xl font-bold font-mono text-farm-ink mt-0.5">{dbCounts.expenses}</div>
              </div>

              {/* Counts Bento Block 3 */}
              <div className="p-3 bg-stone-50 border border-stone-100 rounded-xl text-center">
                <div className="text-stone-400 font-bold uppercase text-[9px] tracking-wide">Staff &amp; Operators registered</div>
                <div className="text-xl font-bold font-mono text-farm-ink mt-0.5">{dbCounts.users}</div>
              </div>

            </div>

            <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-farm-accent-soft">
              
              {/* Button: Export */}
              <button
                onClick={handleExportDatabase}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-4 rounded-xl transition cursor-pointer flex items-center justify-center gap-2 text-xs uppercase"
              >
                <FileJson className="w-4 h-4" /> Export Backup (.JSON)
              </button>

              {/* Button: Import */}
              <label className="flex-1 bg-sky-50 text-sky-700 border border-sky-200 hover:bg-sky-100 font-bold py-3 px-4 rounded-xl transition cursor-pointer flex items-center justify-center gap-2 text-xs uppercase text-center">
                <input
                  type="file"
                  accept=".json"
                  onChange={handleImportDatabase}
                  className="hidden"
                />
                <ShieldCheck className="w-4 h-4" /> Import Ledger File
              </label>

              {/* Button: Reset */}
              {currentUser.role === 'Developer' || currentUser.role === 'Owner' ? (
                <button
                  onClick={handleResetDatabase}
                  className="flex-1 bg-red-50 text-farm-danger hover:bg-red-100 border border-red-200 font-bold py-3 px-4 rounded-xl transition cursor-pointer flex items-center justify-center gap-2 text-xs uppercase"
                >
                  <Trash2 className="w-4 h-4" /> Factory Reset ERP
                </button>
              ) : null}

            </div>
            
            <p className="text-[10px] text-stone-400 text-center mt-4">
              All transactions are calculated, parsed, and logged strictly inside your browser's IndexedDB engine. Absolute privacy. 100% cloud-less resilience.
            </p>
          </div>

          {/* User Session & Authorization Controls */}
          <div className="bg-white rounded-2xl shadow-md border border-farm-accent-soft p-6">
            <h3 className="text-base font-bold text-red-600 flex items-center gap-2 mb-4">
              <LogOut className="w-5 h-5 text-red-600" />
              <span>Active User Session Controls</span>
            </h3>
            <p className="text-xs text-farm-muted mb-4 text-left">
              Securely sign out of your Pick Ur Veggie ERP active session. This terminates your current workspace login token. Active session registration: <strong className="text-farm-ink font-mono font-bold">{currentUser.username}</strong> (<span className="text-farm-green font-extrabold">{currentUser.role}</span>)
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={handleLogoutClick}
                className="w-full sm:w-auto bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-6 rounded-xl transition cursor-pointer flex items-center justify-center gap-2 text-xs uppercase"
              >
                <LogOut className="w-4 h-4" /> SECURELY SIGN OUT
              </button>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
