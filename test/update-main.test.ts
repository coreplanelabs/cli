import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

const directory = mkdtempSync(join(tmpdir(), 'polylane-update-main-'));
const bundle = join(directory, 'main.mjs');
const replacement = "#!/usr/bin/env node\nprocess.stdout.write('polylane 2.0.0\\n');\n";
const checksum = createHash('sha256').update(replacement).digest('hex');
const preload = join(directory, 'preload.mjs');

before(async () => {
  await build({
    entryPoints: ['src/main.ts'], bundle: true, platform: 'node', format: 'esm',
    alias: { 'jsonc-parser': 'jsonc-parser/lib/esm/main.js' }, outfile: bundle,
    define: { 'process.env.POLYLANE_CLI_VERSION': '"1.0.0"' },
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  });
  writeFileSync(preload, `
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (process.env.FAIL_UPDATE === '1') throw new Error('network unavailable');
      if (url.endsWith('/latest')) return Response.json({ version: '2.0.0' });
      if (url.endsWith('/checksums.txt')) return new Response(${JSON.stringify(checksum + '  polylane.mjs\n')});
      if (url.endsWith('/polylane.mjs')) return new Response(${JSON.stringify(replacement)});
      throw new Error('Unexpected request: ' + url);
    };
  `);
});
after(() => rmSync(directory, { recursive: true, force: true }));

function installed(name: string): { file: string; launcher: string; home: string } {
  const home = join(directory, name);
  const bin = join(home, '.polylane', 'bin');
  mkdirSync(bin, { recursive: true });
  const file = join(bin, 'polylane.mjs');
  writeFileSync(file, readFileSync(bundle), { mode: 0o755 });
  const launcher = join(bin, 'polylane');
  symlinkSync('polylane.mjs', launcher);
  return { file, launcher, home };
}

function run(home: string, launcher: string, options: Record<string, string> = {}, args = ['config', 'show', '--output', 'json']) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('POLYLANE_') || [
      'CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'JENKINS_URL', 'CIRCLECI', 'TRAVIS',
      'BUILDKITE', 'TEAMCITY_VERSION', 'BITBUCKET_BUILD_NUMBER', 'CODEBUILD_BUILD_ID',
      'TF_BUILD', 'VERCEL', 'NETLIFY', 'CF_PAGES', 'CLOUDFLARE_PAGES', 'RENDER',
      'RAILWAY_ENVIRONMENT', 'FLY_APP_NAME', 'NODE_OPTIONS',
    ].includes(key)) delete env[key];
  }
  return spawnSync(process.execPath, ['--import', preload, launcher, ...args], {
    encoding: 'utf8', timeout: 20_000,
    env: { ...env, HOME: home, USERPROFILE: home, POLYLANE_TELEMETRY: '0', ...options },
  });
}

describe('bundled CLI automatic update', { skip: process.platform === 'win32' }, () => {
  it('keeps JSON clean and installs the version used by the next invocation', () => {
    const { file, launcher, home } = installed('success');
    const result = run(home, launcher);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).domain, 'api.polylane.com');
    assert.match(result.stderr, /Updated to 2\.0\.0/);
    assert.equal(readFileSync(file, 'utf8'), replacement);
    const next = run(home, launcher, {}, ['--version']);
    assert.equal(next.status, 0);
    assert.equal(next.stdout, 'polylane 2.0.0\n');
  });

  it('preserves a successful command and the old executable when the network is down', () => {
    const { file, launcher, home } = installed('offline');
    const result = run(home, launcher, { FAIL_UPDATE: '1' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).domain, 'api.polylane.com');
    assert.equal(readFileSync(file, 'utf8'), readFileSync(bundle, 'utf8'));
    const next = run(home, launcher, {}, ['--version']);
    assert.equal(next.stdout, 'polylane 1.0.0\n');
  });

  it('respects the automatic-update opt-out in the bundled executable', () => {
    const { file, launcher, home } = installed('opt-out');
    const result = run(home, launcher, { POLYLANE_NO_AUTO_UPDATE: '1' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).domain, 'api.polylane.com');
    assert.equal(readFileSync(file, 'utf8'), readFileSync(bundle, 'utf8'));
  });
});
