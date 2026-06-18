import React, { useState, useEffect } from 'react';
import { db } from '../db';
import { validateBackup, restoreFromData } from '../db/backup';
import { Cloud, Check, Loader2, AlertTriangle, AlertCircle, RefreshCw } from 'lucide-react';

export function BackupBadge() {
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [lastChange, setLastChange] = useState<string | null>(null);
  const [status, setStatus] = useState<'clean' | 'warn' | 'danger'>('clean');
  const [badgeText, setBadgeText] = useState<string>('Data Secured');
  const [isBackingUp, setIsBackingUp] = useState<boolean>(false);

  // Poll database backup stamps every 5 seconds to remain active
  useEffect(() => {
    updateStamps();
    const interval = setInterval(updateStamps, 5000);
    return () => clearInterval(interval);
  }, []);

  const updateStamps = async () => {
    try {
      const backupRow = await db.meta.get('lastBackup');
      const changeRow = await db.meta.get('lastChange');
      
      const backupTime = backupRow ? backupRow.value : null;
      const changeTime = changeRow ? changeRow.value : null;

      setLastBackup(backupTime);
      setLastChange(changeTime);

      if (!backupTime) {
        setStatus('danger');
        setBadgeText('Backup Required');
        return;
      }

      const backupDate = new Date(backupTime).getTime();
      const changeDate = changeTime ? new Date(changeTime).getTime() : 0;
      const timeSinceBackup = Date.now() - backupDate;
      const hoursSinceBackup = timeSinceBackup / (1000 * 60 * 60);

      if (hoursSinceBackup >= 24) {
        setStatus('danger');
        setBadgeText('Backup Due (Over 24h)');
      } else if (changeDate > backupDate) {
        setStatus('warn');
        setBadgeText('Unsaved Local Changes');
      } else if (hoursSinceBackup >= 8) {
        setStatus('warn');
        setBadgeText('Backup Advised (8h+)');
      } else {
        setStatus('clean');
        const mins = Math.round(timeSinceBackup / (1000 * 60));
        setBadgeText(mins < 1 ? 'Data Secured' : `Backup: ${mins}m ago`);
      }
    } catch {
      // Ignored during intermediate build refreshes
    }
  };

  const handleBackup = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isBackingUp) return;
    setIsBackingUp(true);
    try {
      // Direct Dexie fetch and download logic
      const exprTime = new Date().toISOString();
      const allTables = [
        'users', 'prices', 'transactions', 'expenses', 
        'equipment', 'employees', 'cashAdvances', 'wages', 
        'cashEntries', 'scheduleEvents', 'projects', 'meta'
      ];
      const payload: Record<string, any> = {
        format: 'PickUrVeggieERP_Backup',
        exportedAt: exprTime,
        tables: {}
      };

      for (const tbl of allTables) {
        payload.tables[tbl] = await db.table(tbl).toArray();
      }

      const stringified = JSON.stringify(payload, null, 2);
      const blob = new Blob([stringified], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const d = new Date();
      const timestamp = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}_${String(d.getUTCHours()).padStart(2, '0')}z`;
      const filename = `puv-app-backup-${timestamp}.json`;

      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);

      // Record backup time to reset alarm
      await db.meta.put({ key: 'lastBackup', value: exprTime });
      updateStamps();
    } catch (err: any) {
      alert('Error triggering backup: ' + err.message);
    } finally {
      setIsBackingUp(false);
    }
  };

  // Color selection config
  let pillColor = 'bg-farm-green text-farm-accent-soft border-farm-accent';
  let Icon = hoverDot;

  if (status === 'danger') {
    pillColor = 'bg-red-100 text-farm-danger border-farm-danger animate-pulse';
    Icon = AlertTriangleIcon;
  } else if (status === 'warn') {
    pillColor = 'bg-amber-100 text-farm-warn border-farm-warn';
    Icon = AlertCircleIcon;
  }

  return (
    <button
      onClick={handleBackup}
      title="Click to instantly execute a full local backup file download"
      className={`border px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-2 cursor-pointer shadow-sm hover:brightness-105 active:scale-95 transition ${pillColor} focus:outline-none select-none`}
    >
      {isBackingUp ? (
        <Loader2 className="w-4 h-4 animate-spin text-farm-green" />
      ) : (
        <Icon />
      )}
      <span className="font-semibold tracking-wide text-[11px]">{badgeText}</span>
    </button>
  );
}

function hoverDot() {
  return <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping border border-white" />;
}

function AlertTriangleIcon() {
  return <AlertTriangle className="w-4 h-4 text-farm-danger" />;
}

function AlertCircleIcon() {
  return <AlertCircle className="w-4 h-4 text-farm-warn" />;
}
