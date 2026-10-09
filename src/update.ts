import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Config } from './config/schema';
import { UPDATE_STATE_FILE } from './config/paths';
import { CLIError } from './errors/base';
import { ExitCode } from './errors/codes';
import { detectInstallation, runProgram, type Installation } from './install';
import { ensureDir, readJsonFile, writeJsonFile } from './utils/fs';
import { isCI } from './utils/env';

const PACKAGE = '@coreplane/polylane';
const RELEASES = 'https://github.com/coreplanelabs/cli/releases/download';
const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const CHECK_INTERVAL = 24 * 60 * 60 * 1000;

function recentlyChecked(file: string): boolean {
  const state = readJsonFile<{ file: string; lastCheck: number }>(UPDATE_STATE_FILE);
  const age = Date.now() - (state?.lastCheck ?? NaN);
  return state?.file === file && age >= 0 && age < CHECK_INTERVAL;
}

function isNewer(latest: string, current: string): boolean {
  const a = latest.split('.').map(Number);
  const b = current.split(/[.+-]/).slice(0, 3).map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!;
  return current.includes('-');
}

async function getVersion(file: string): Promise<string> {
  const output = await runProgram(process.execPath, [file, '--version']);
  const match = /^polylane (\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?)$/.exec(output);
  if (!match) throw new Error('Installed CLI did not report a valid version');
  return match[1]!;
}

async function get(url: string): Promise<Response> {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Update download failed (${response.status})`);
  return response;
}

async function replaceStandalone(install: Installation, latest: string): Promise<void> {
  const base = `${RELEASES}/v${latest}`;
  const checksums = await (await get(`${base}/checksums.txt`)).text();
  const checksum = checksums.split('\n').map((line) => /^([a-fA-F0-9]{64})\s+\*?polylane\.mjs\s*$/.exec(line))
    .find((match) => match !== null)?.[1]?.toLowerCase();
  if (!checksum) throw new Error('Release has no checksum for polylane.mjs');
  const response = await get(`${base}/polylane.mjs`);
  if (Number(response.headers.get('content-length')) > 20 * 1024 * 1024) throw new Error('Update bundle is too large');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 20 * 1024 * 1024) throw new Error('Update bundle is too large');
  if (createHash('sha256').update(bytes).digest('hex') !== checksum) throw new Error('Update checksum mismatch');
  const original = statSync(install.file);
  const staged = join(dirname(install.file), `.polylane-update-${randomUUID()}.mjs`);
  try {
    writeFileSync(staged, bytes, { flag: 'wx', mode: original.mode & 0o777 });
    if (await getVersion(staged) !== latest) throw new Error('Downloaded CLI version does not match the release');
    const now = statSync(install.file);
    if (now.ino !== original.ino || now.mtimeMs !== original.mtimeMs || now.size !== original.size) {
      throw new Error('Installed CLI changed during the update; retry');
    }
    renameSync(staged, install.file);
  } finally { rmSync(staged, { force: true }); }
}

async function installLatest(install: Installation, latest: string): Promise<void> {
  if (install.kind === 'standalone') {
    await replaceStandalone(install, latest);
    return;
  }
  if (install.kind === 'npm') {
    await runProgram('npm', ['install', '--global', '--prefix', install.prefix!, `${PACKAGE}@${latest}`, '--ignore-scripts', '--no-audit', '--no-fund'], 120_000);
  } else if (install.kind === 'bun') {
    await runProgram('bun', ['add', '--global', `${PACKAGE}@${latest}`, '--ignore-scripts'], 120_000);
  } else if (install.kind === 'brew') {
    await runProgram('brew', ['update', '--quiet'], 120_000);
    await runProgram('brew', ['upgrade', '--formula', 'coreplanelabs/tap/polylane'], 120_000);
    const prefix = await runProgram('brew', ['--prefix', 'polylane']);
    if (await getVersion(join(prefix, 'bin', 'polylane')) !== latest) throw new Error('Homebrew has not installed the latest CLI version yet');
    return;
  }
  if (await getVersion(install.file) !== latest) throw new Error('Package manager did not install the requested CLI version');
}

export async function updateCli(config: Config, automatic = false): Promise<void> {
  const say = (message: string): void => { if (!config.quiet) process.stderr.write(message + '\n'); };
  if (isCI()) {
    if (!automatic) say('Skipping updates in CI');
    return;
  }
  if (process.env.POLYLANE_VERSION && process.env.POLYLANE_VERSION !== 'latest') {
    if (!automatic) say(`CLI version is pinned by POLYLANE_VERSION=${process.env.POLYLANE_VERSION}`);
    return;
  }
  if (automatic && (config.dryRun || process.env.POLYLANE_NO_AUTO_UPDATE === '1')) return;
  let lock: string | undefined;
  let updating = false;
  try {
    if (automatic && recentlyChecked(realpathSync(process.argv[1] ?? ''))) return;
    const install = await detectInstallation();
    if (install.kind === 'dev' || install.kind === 'unknown') {
      if (automatic) return;
      throw new Error(`Cannot update this ${install.kind} install; use a global npm, Bun, Homebrew, or standalone install`);
    }
    if (install.pinned) {
      if (!automatic) say('CLI version is pinned by Homebrew');
      return;
    }
    if (!config.dryRun) {
      ensureDir(dirname(UPDATE_STATE_FILE));
      const path = `${UPDATE_STATE_FILE}.${createHash('sha256').update(install.file).digest('hex').slice(0, 16)}.lock`;
      try {
        if (Date.now() - statSync(path).mtimeMs > 10 * 60 * 1000) rmSync(path, { recursive: true });
      } catch { /* No existing lock. */ }
      try { mkdirSync(path); lock = path; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          if (!automatic) say('Another CLI update is running');
          return;
        }
        throw error;
      }
      // Recheck after taking the lock: another process may have just updated.
      if (automatic && recentlyChecked(install.file)) return;
      writeJsonFile(UPDATE_STATE_FILE, { file: install.file, lastCheck: Date.now() });
    }
    const current = await getVersion(install.file);
    if (automatic && current.includes('-')) return;
    const data = await (await get(`https://registry.npmjs.org/${PACKAGE}/latest`)).json() as { version?: string };
    const latest = data.version;
    if (!latest || !STABLE_VERSION.test(latest)) throw new Error('npm returned an invalid latest version');
    if (!isNewer(latest, current)) {
      if (!automatic) say(`You're up to date (${current}, ${install.kind})`);
      return;
    }
    if (config.dryRun) {
      say(`Would update ${install.kind} install from ${current} to ${latest}: ${install.file}`);
      return;
    }
    say(`Updating ${install.kind} install from ${current} to ${latest}`);
    updating = true;
    await installLatest(install, latest);
    say(`Updated to ${latest}. The next command uses the new version.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (automatic) { if (updating || config.verbose) say(`Automatic CLI update skipped: ${message}`); }
    else throw new CLIError(message, ExitCode.GENERAL, 'Retry with: polylane update');
  } finally {
    if (lock) {
      try { rmSync(lock, { recursive: true, force: true }); }
      catch { /* Lock cleanup must not change the user's command result. */ }
    }
  }
}
