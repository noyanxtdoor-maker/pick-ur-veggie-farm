// Tier-2 static guards (C6 §8 / C3 §12) — run with: node scripts/guards/static-guards.mjs
// Guard 3: no role-name authorization.  Guard 5: no floating-point money.
// Source-text scans (no DB). DB-backed guards (RLS, tenant-ownership, audit-immutability, drift) live in db-guards.sql + the CI job.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = process.cwd();
let failures = 0;
const fail = (guard, msg) => { console.error(`FAIL [${guard}] ${msg}`); failures++; };

// `src/` is the V2 prototype reference (ODR-001) — historical, slated for replacement, not V3 code.
// These guards govern V3 implementation code + migrations; they do not police the prototype being replaced.
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'src']);

function walk(dir, exts, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, exts, out);
    else if (exts.includes(extname(p))) out.push(p);
  }
  return out;
}

// ── Guard 3: no role-name authorization (B1/C7 §2) ──
// Forbids decisions on role-name strings, e.g. role === 'Owner', role == "Admin".
const roleNameRe = /\brole\s*(===|==|!=|!==)\s*['"`]/i;
for (const f of walk(ROOT, ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.sql'])) {
  if (f.includes(join('scripts', 'guards'))) continue; // the guard's own pattern
  const text = readFileSync(f, 'utf8');
  text.split(/\r?\n/).forEach((line, i) => {
    if (roleNameRe.test(line)) fail('no-role-name-auth', `${f}:${i + 1}  ${line.trim()}`);
  });
}

// ── Guard 5: no floating-point money (B2) ──
// Forbids float/real/double-precision column types in migrations (any column; money must be NUMERIC).
const floatRe = /\b(float4|float8|float|real|double\s+precision)\b/i;
const migDir = join(ROOT, 'supabase', 'migrations');
let migFiles = [];
try { migFiles = walk(migDir, ['.sql']); } catch { /* no migrations yet */ }
for (const f of migFiles) {
  readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => {
    const code = line.split('--')[0]; // ignore comments
    if (floatRe.test(code)) fail('no-float-money', `${f}:${i + 1}  ${line.trim()}`);
  });
}

if (failures === 0) console.log('static-guards: PASS (no-role-name-auth, no-float-money)');
process.exit(failures === 0 ? 0 : 1);
