import { after, afterEach, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'polylane-update-test-')));
process.env.HOME = home;
const { updateCommand } = await import('../src/commands/update');
const { updateCli } = await import('../src/update');
const { detectInstallSource } = await import('../src/telemetry/environment');
const { mockConfig } = await import('./helpers/config');
const originalArgv = [...process.argv];
const originalEnv = { ...process.env };
const oldBundle = "#!/usr/bin/env node\nprocess.stdout.write('polylane 1.0.0\\n');\n";
const newBundle = "#!/usr/bin/env node\nprocess.stdout.write('polylane 2.0.0\\n');\n";
let file: string;
let stderr: string;

function serve(bundle = newBundle, checksum = createHash('sha256').update(bundle).digest('hex')): void {
  mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/latest')) return Response.json({ version: '2.0.0' });
    if (url.endsWith('/checksums.txt')) return new Response(`${checksum}  polylane.mjs\n`);
    if (url.endsWith('/polylane.mjs')) return new Response(bundle);
    throw new Error(`Unexpected request: ${url}`);
  });
}

  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('POLYLANE_') || ['CI', 'GITHUB_ACTIONS'].includes(key)) delete process.env[key];
    }
    rmSync(join(home, '.polylane'), { recursive: true, force: true });
    file = join(home, '.polylane', 'bin', 'polylane.mjs');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, oldBundle, { mode: 0o755 });
    symlinkSync('polylane.mjs', join(dirname(file), 'polylane'));
    process.argv[1] = join(dirname(file), 'polylane');
    stderr = '';
    mock.method(process.stderr, 'write', (chunk: string | Uint8Array) => {
      stderr += String(chunk);
      return true;
    });
  });

  afterEach(() => {
    mock.restoreAll();
    process.argv = [...originalArgv];
    process.env = { ...originalEnv, HOME: home };
  });
  after(() => rmSync(home, { recursive: true, force: true }));

describe('polylane update', () => {
  it('updates the active standalone install without a prompt', async () => {
    serve();
    assert.equal(detectInstallSource(), 'curl');
    await updateCommand.execute(mockConfig(), {}, {});
    assert.equal(readFileSync(file, 'utf8'), newBundle);
    const next = spawnSync(process.execPath, [process.argv[1], '--version'], { encoding: 'utf8' });
    assert.equal(next.status, 0);
    assert.equal(next.stdout, 'polylane 2.0.0\n');
    assert.match(stderr, /Updated to 2\.0\.0/);
  });

  it('refuses a checksum mismatch and preserves the working copy', async () => {
    serve(newBundle, '0'.repeat(64));
    await assert.rejects(updateCommand.execute(mockConfig(), {}, {}), /checksum/i);
    assert.equal(readFileSync(file, 'utf8'), oldBundle);
  });

  it('does not replace the working copy with a bundle that reports the wrong version', async () => {
    serve(oldBundle);
    await assert.rejects(updateCommand.execute(mockConfig(), {}, {}), /version/i);
    assert.equal(readFileSync(file, 'utf8'), oldBundle);
  });

  it('shows a dry run without changing the install', async () => {
    serve();
    await updateCommand.execute(mockConfig({ dryRun: true }), {}, {});
    assert.equal(readFileSync(file, 'utf8'), oldBundle);
    assert.match(stderr, /Would update.*2\.0\.0/);
  });

  it('leaves CI and version-pinned runs unchanged', async () => {
    serve();
    process.env.CI = 'true';
    await updateCommand.execute(mockConfig({ verbose: true }), {}, {});
    assert.match(stderr, /Skipping.*CI/);
    delete process.env.CI;
    process.env.POLYLANE_VERSION = '1.0.0';
    await updateCommand.execute(mockConfig(), {}, {});
    assert.match(stderr, /pinned/i);
    assert.equal(readFileSync(file, 'utf8'), oldBundle);
  });
});

describe('automatic updates', () => {
  it('updates once, then honors the daily check interval', async () => {
    serve();
    await updateCli(mockConfig(), true);
    assert.equal(readFileSync(file, 'utf8'), newBundle);
    stderr = '';
    mock.method(globalThis, 'fetch', async () => { throw new Error('Should be cached'); });
    await updateCli(mockConfig({ verbose: true }), true);
    assert.equal(readFileSync(file, 'utf8'), newBundle);
    assert.equal(stderr, '');
    const state = JSON.parse(readFileSync(join(home, '.polylane', 'update-state.json'), 'utf8'));
    assert.equal(state.file, file);
    assert.equal(typeof state.lastCheck, 'number');
  });

  it('keeps updates disabled until an explicit update is requested', async () => {
    serve();
    process.env.POLYLANE_NO_AUTO_UPDATE = '1';
    await updateCli(mockConfig(), true);
    assert.equal(readFileSync(file, 'utf8'), oldBundle);
    await updateCommand.execute(mockConfig(), {}, {});
    assert.equal(readFileSync(file, 'utf8'), newBundle);
  });

  it('contains a failed update without breaking the command result', async () => {
    serve(newBundle, '0'.repeat(64));
    await updateCli(mockConfig(), true);
    assert.equal(readFileSync(file, 'utf8'), oldBundle);
    // A failed automatic check must not block an explicit retry.
    serve();
    await updateCommand.execute(mockConfig(), {}, {});
    assert.equal(readFileSync(file, 'utf8'), newBundle);
  });

  it('updates only once when two commands check concurrently', async () => {
    let release!: () => void;
    let started!: () => void;
    const checked = new Promise<void>((resolve) => { started = resolve; });
    const wait = new Promise<void>((resolve) => { release = resolve; });
    serve();
    const fetch = globalThis.fetch;
    mock.method(globalThis, 'fetch', async (...args: Parameters<typeof fetch>) => {
      if (String(args[0]).endsWith('/latest')) { started(); await wait; }
      return fetch(...args);
    });
    const first = updateCli(mockConfig(), true);
    await checked;
    await updateCli(mockConfig(), true);
    release();
    await first;
    assert.equal(readFileSync(file, 'utf8'), newBundle);
  });
});

function manager(name: string, body: string): void {
  const binDir = join(home, 'managers');
  mkdirSync(binDir, { recursive: true });
  writeFileSync(join(binDir, name), `#!${process.execPath}\n${body}\n`, { mode: 0o755 });
  process.env.PATH = binDir + ':' + (originalEnv.PATH ?? '');
}

function packageAt(root: string): string {
  const path = join(root, '@coreplane', 'polylane');
  mkdirSync(join(path, 'dist'), { recursive: true });
  writeFileSync(join(path, 'package.json'), '{"name":"@coreplane/polylane"}');
  const bundle = join(path, 'dist', 'polylane.mjs');
  writeFileSync(bundle, oldBundle, { mode: 0o755 });
  return bundle;
}

describe('package-manager ownership', { skip: process.platform === 'win32' }, () => {
  it('updates the active npm prefix and leaves the standalone copy unchanged', async () => {
    const standalone = file;
    const prefix = join(home, 'opt', 'homebrew');
    const root = join(prefix, 'lib', 'node_modules');
    file = packageAt(root);
    process.argv[1] = file;
    assert.equal(detectInstallSource(), 'npm');
    manager('bun', 'process.exit(1)');
    manager('brew', 'throw new Error("must not use brew for npm")');
    manager('npm', `
      const fs = require('node:fs');
      const args = process.argv.slice(2);
      if (args[0] === 'root') console.log(${JSON.stringify(root)});
      else if (args[0] === 'prefix') console.log(${JSON.stringify(prefix)});
      else if (args[0] === 'install') {
        fs.writeFileSync(${JSON.stringify(file)}, ${JSON.stringify(newBundle)});
        fs.writeFileSync(${JSON.stringify(join(home, 'npm-args.json'))}, JSON.stringify(args));
        console.log('package manager progress');
      } else process.exit(1);
    `);
    serve();
    await updateCommand.execute(mockConfig(), {}, {});
    assert.equal(readFileSync(file, 'utf8'), newBundle);
    assert.equal(readFileSync(standalone, 'utf8'), oldBundle);
    assert.deepEqual(JSON.parse(readFileSync(join(home, 'npm-args.json'), 'utf8')), [
      'install', '--global', '--prefix', prefix, '@coreplane/polylane@2.0.0', '--ignore-scripts', '--no-audit', '--no-fund',
    ]);
    assert.match(stderr, /Updating npm install/);
  });

  it('refuses a local package when npm owns a different prefix', async () => {
    file = packageAt(join(home, 'project', 'node_modules'));
    process.argv[1] = file;
    const otherRoot = join(home, 'different-prefix', 'node_modules');
    packageAt(otherRoot);
    manager('bun', 'process.exit(1)');
    manager('npm', `console.log(${JSON.stringify(otherRoot)})`);
    serve();
    await assert.rejects(updateCommand.execute(mockConfig(), {}, {}), /unknown install/);
    assert.equal(readFileSync(file, 'utf8'), oldBundle);
  });

  it('updates a Bun install only when its global launcher resolves to the active file', async () => {
    const root = join(home, 'bun-global', 'node_modules');
    file = packageAt(root);
    const binDir = join(home, 'bun-bin');
    mkdirSync(binDir, { recursive: true });
    symlinkSync(file, join(binDir, 'polylane'));
    process.argv[1] = file;
    manager('bun', `
      const fs = require('node:fs');
      const args = process.argv.slice(2);
      if (args[0] === 'pm') console.log(${JSON.stringify(binDir)});
      else if (args[0] === 'add') {
        fs.writeFileSync(${JSON.stringify(file)}, ${JSON.stringify(newBundle)});
        console.log('Bun progress');
      } else process.exit(1);
    `);
    serve();
    await updateCommand.execute(mockConfig(), {}, {});
    assert.equal(readFileSync(file, 'utf8'), newBundle);
    assert.match(stderr, /Updating bun install/);
  });

  it('respects a Homebrew pin, then updates after the pin is removed', async () => {
    const cellar = join(home, 'Cellar', 'polylane');
    const prefix = join(cellar, '1.0.0');
    const root = join(prefix, 'libexec', 'lib', 'node_modules');
    file = packageAt(root);
    const binDir = join(prefix, 'bin');
    mkdirSync(binDir, { recursive: true });
    symlinkSync(file, join(binDir, 'polylane'));
    process.argv[1] = file;
    const pin = join(home, 'brew-pin');
    writeFileSync(pin, 'pinned');
    manager('brew', `
      const fs = require('node:fs');
      const args = process.argv.slice(2);
      if (args[0] === '--cellar') console.log(${JSON.stringify(cellar)});
      else if (args[0] === 'list') console.log(fs.existsSync(${JSON.stringify(pin)}) ? 'polylane' : '');
      else if (args[0] === '--prefix') console.log(${JSON.stringify(prefix)});
      else if (args[0] === 'update') process.exit(0);
      else if (args[0] === 'upgrade') fs.writeFileSync(${JSON.stringify(file)}, ${JSON.stringify(newBundle)});
      else process.exit(1);
    `);
    serve();
    await updateCommand.execute(mockConfig(), {}, {});
    assert.equal(readFileSync(file, 'utf8'), oldBundle);
    assert.match(stderr, /pinned by Homebrew/);
    rmSync(pin);
    await updateCommand.execute(mockConfig(), {}, {});
    assert.equal(readFileSync(file, 'utf8'), newBundle);
    assert.match(stderr, /Updating brew install/);
  });
});
