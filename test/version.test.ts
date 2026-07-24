import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveVersion } from '../src/version';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('resolveVersion', () => {
  it('prefers the baked build-time version', () => {
    assert.equal(resolveVersion('1.2.3'), '1.2.3');
  });

  it('falls back to package.json in dev mode', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')) as {
      version: string;
    };
    assert.equal(resolveVersion(undefined), pkg.version);
    assert.notEqual(resolveVersion(undefined), '0.0.0');
  });

  it('treats an empty baked value as unset', () => {
    assert.notEqual(resolveVersion(''), '');
  });
});
