import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let cachedVersion: string | null = null;

// The released bundle ships as a standalone dist/polylane.mjs with no
// package.json next to it, so build.ts bakes the version in via an esbuild
// define on POLYLANE_CLI_VERSION. Reading package.json is the dev-mode
// fallback (tsx src/main.ts from a checkout).
export function resolveVersion(baked = process.env.POLYLANE_CLI_VERSION): string {
  if (baked) return baked;
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string };
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

export function getCliVersion(): string {
  cachedVersion ??= resolveVersion();
  return cachedVersion;
}
