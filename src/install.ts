import { execFile } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { readJsonFile } from './utils/fs';

export interface Installation {
  kind: 'standalone' | 'npm' | 'bun' | 'brew' | 'dev' | 'unknown';
  file: string;
  prefix?: string;
  pinned?: boolean;
}

const exec = promisify(execFile);

export async function runProgram(program: string, args: string[], timeout = 10_000): Promise<string> {
  let bin = program;
  let argv = args;
  if (process.platform === 'win32' && program === 'npm') {
    const directories = [dirname(process.execPath), ...(process.env.PATH ?? '').split(delimiter)];
    const script = directories.map((dir) => join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'))
      .find((path) => existsSync(path));
    if (!script) throw new Error('Cannot find npm-cli.js for the active Node installation');
    bin = process.execPath;
    argv = [script, ...args];
  }
  const { stdout } = await exec(bin, argv, {
    timeout, maxBuffer: 2 * 1024 * 1024, windowsHide: true,
    env: { ...process.env, POLYLANE_NO_AUTO_UPDATE: '1', npm_config_yes: 'true', NONINTERACTIVE: '1' },
  });
  return stdout.trim();
}

export async function detectInstallation(launcher = process.argv[1] ?? ''): Promise<Installation> {
  let file: string;
  try { file = realpathSync(launcher); }
  catch { return { kind: 'unknown', file: resolve(launcher) }; }
  const normalized = file.replaceAll('\\', '/');
  if (normalized.endsWith('/src/main.ts')) return { kind: 'dev', file };

  // The CLI file, not the Node executable, must belong to this Cellar.
  if (/\/Cellar\/polylane\//i.test(normalized)) {
    const cellar = await runProgram('brew', ['--cellar', 'polylane']);
    if (file.startsWith(realpathSync(cellar) + '/')) {
      const pinned = await runProgram('brew', ['list', '--pinned', 'polylane']);
      return { kind: 'brew', file, pinned: pinned.split(/\s+/).includes('polylane') };
    }
    return { kind: 'unknown', file };
  }

  const packageRoot = dirname(dirname(file));
  const pkg = readJsonFile<{ name?: string }>(join(packageRoot, 'package.json'));
  if (pkg?.name === '@coreplane/polylane') {
    if (existsSync(join(packageRoot, 'src', 'main.ts'))) return { kind: 'dev', file };
    try {
      const binDir = await runProgram('bun', ['pm', 'bin', '-g']);
      if (realpathSync(join(binDir, 'polylane')) === file) return { kind: 'bun', file };
    } catch { /* Bun is optional. */ }
    try {
      const root = await runProgram('npm', ['root', '--global']);
      if (realpathSync(join(root, '@coreplane', 'polylane')) === packageRoot) {
        const prefix = await runProgram('npm', ['prefix', '--global']);
        return { kind: 'npm', file, prefix };
      }
    } catch { /* Local and npx installs are not global installs. */ }
    return { kind: 'unknown', file };
  }

  if (normalized.endsWith('/polylane.mjs') && !normalized.includes('/node_modules/')) {
    try {
      if (realpathSync(join(dirname(file), 'polylane')) === file) return { kind: 'standalone', file };
    } catch { /* Windows uses a cmd shim. */ }
    if (process.platform === 'win32' && existsSync(join(dirname(file), 'polylane.cmd'))) return { kind: 'standalone', file };
  }
  return { kind: 'unknown', file };
}
