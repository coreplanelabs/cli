import { build } from 'esbuild';
import { readFileSync, chmodSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { generateAll } from './codegen/index';
import { loadEnvLocal } from './codegen/env-local';

async function main(): Promise<void> {
  // Local dev loads .env.local here; CI supplies env vars on the workflow
  // step from repo secrets, and process.env always wins over the file.
  loadEnvLocal();

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
