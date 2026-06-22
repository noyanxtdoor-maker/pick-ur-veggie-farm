// Tier-2 Guard 6 — schema-drift detection (C3 §12).
// The migrated database must equal the migration history: `supabase db diff` after a reset must be empty.
// Run with: node scripts/guards/check-drift.mjs   (requires the local Supabase stack running)
import { execSync } from 'node:child_process';

// Supabase prints status (incl. "No schema changes found") to stderr and the diff SQL to stdout;
// merge both with 2>&1 so the status line is visible to the check.
let out = '';
try {
  out = execSync('npx supabase db diff 2>&1', { encoding: 'utf8' });
} catch (e) {
  console.error('check-drift: FAIL (supabase db diff errored)\n' + (e.stdout || '') + (e.stderr || ''));
  process.exit(1);
}

if (/no schema changes found/i.test(out)) {
  console.log('check-drift: PASS (database matches migration history)');
  process.exit(0);
}
console.error('check-drift: FAIL — untracked schema drift detected:\n' + out);
process.exit(1);
