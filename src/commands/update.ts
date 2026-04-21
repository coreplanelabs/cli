import type { Command } from '../command';
import type { Config } from '../config/schema';
import { UPDATE_STATE_FILE } from '../config/paths';
import { readJsonFile, writeJsonFile } from '../utils/fs';
import { isCI } from '../utils/env';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

interface UpdateState {
  lastCheck: number;
  latest: string | null;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function getCurrentVersion(): string {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(__dirname, '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string };
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

async function fetchLatest(): Promise<string | null> {
  try {
    const res = await fetch('https://registry.npmjs.org/@coreplane/nominal/latest', {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

export const updateCommand: Command = {
  name: 'update',
  description: 'Check for CLI updates',
  async execute(config: Config): Promise<void> {
    const current = getCurrentVersion();
    process.stderr.write(`Current version: ${current}\n`);

    if (isCI() && !config.verbose) {
      process.stderr.write('Skipping update check in CI\n');
      return;
    }

    const latest = await fetchLatest();
    if (!latest) {
      process.stderr.write('Could not fetch latest version from npm\n');
      return;
    }

    writeJsonFile(UPDATE_STATE_FILE, { lastCheck: Date.now(), latest });

    if (compareVersions(latest, current) > 0) {
      process.stderr.write(`Update available: ${latest}\n`);
      process.stderr.write(`Run: npm install -g @coreplane/nominal@${latest}\n`);
      process.stderr.write(`  or: brew upgrade nominal\n`);
    } else {
      process.stderr.write(`Already on the latest version\n`);
    }
  },
};

export async function checkForUpdateAsync(): Promise<string | null> {
  if (isCI()) return null;
  const state = readJsonFile<UpdateState>(UPDATE_STATE_FILE);
  if (state && Date.now() - state.lastCheck < CACHE_TTL_MS) {
    const current = getCurrentVersion();
    if (state.latest && compareVersions(state.latest, current) > 0) {
      return state.latest;
    }
    return null;
  }
  const latest = await fetchLatest();
  writeJsonFile(UPDATE_STATE_FILE, { lastCheck: Date.now(), latest });
  const current = getCurrentVersion();
  if (latest && compareVersions(latest, current) > 0) return latest;
  return null;
}
