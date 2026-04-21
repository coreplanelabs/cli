import { build } from 'esbuild';
import { readFileSync, chmodSync, mkdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { generateAll } from './codegen/index';

function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(path)) return out;
  const raw = readFileSync(path, 'utf-8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

async function main(): Promise<void> {
  // Step 1: codegen from OpenAPI spec
  // Build inputs come from two places:
  //   - .env.local (gitignored) for local dev convenience
  //   - process.env for CI (set via repo secrets / workflow env)
  // process.env wins over .env.local if both are set.
  const envLocal = parseEnvFile(join(process.cwd(), '.env.local'));
  for (const [k, v] of Object.entries(envLocal)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }

  await generateAll();

  // Step 2: read version
  const pkg = JSON.parse(readFileSync('package.json', 'utf-8')) as { version: string };

  // Step 3: bundle with esbuild
  mkdirSync('dist', { recursive: true });
  const outfile = join('dist', 'nominal.mjs');

  const define: Record<string, string> = {
    'process.env.NOMINAL_CLI_VERSION': JSON.stringify(pkg.version),
  };
  // Bake every NOMINAL_* env var visible at build time into the bundle, so the
  // produced binary works without needing those vars set at runtime.
  // - Locally: comes from .env.local (gitignored — your dev domain / dev OAuth)
  // - In CI release: comes from GitHub repo secrets exposed in the workflow
  // - Clean checkout with no env: bundle uses the prod fallbacks in source
  const baked: string[] = [];
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith('NOMINAL_') || v === undefined) continue;
    define[`process.env.${k}`] = JSON.stringify(v);
    baked.push(k);
  }

  const result = await build({
    entryPoints: ['src/main.ts'],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'esm',
    outfile,
    minify: true,
    sourcemap: false,
    banner: {
      js: `#!/usr/bin/env node
import { createRequire as __nominalCreateRequire } from 'node:module';
const require = __nominalCreateRequire(import.meta.url);`,
    },
    define,
    logLevel: 'error',
  });

  if (result.errors.length > 0) {
    for (const err of result.errors) {
      process.stderr.write(`[build] error: ${err.text}\n`);
    }
    process.exit(1);
  }

  chmodSync(outfile, 0o755);
  const size = statSync(outfile).size;
  const tag = baked.length > 0 ? ` (baked: ${baked.join(', ')})` : '';
  process.stderr.write(`[build] wrote ${outfile} (${(size / 1024).toFixed(1)} KB)${tag}\n`);
}

main().catch((err: Error) => {
  process.stderr.write(`[build] error: ${err.message}\n`);
  process.exit(1);
});
