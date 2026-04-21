import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Load .env.local into process.env for local dev. A no-op in CI (file is
// gitignored). We do this in userland instead of via `node --env-file-if-exists`
// because that flag doesn't exist in Node < 20.12 and our engines policy is
// Node >= 18. process.env always wins — CI-provided secrets stay authoritative.
export function loadEnvLocal(): void {
  const path = join(process.cwd(), '.env.local');
  if (!existsSync(path)) return;

  const raw = readFileSync(path, 'utf-8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
