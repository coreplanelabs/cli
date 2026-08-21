import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildCloudflareTokenUrl } from '../src/commands/cloud/cloudflare-token-url';

type Permission = { key: string; type: string };

function parsePermissions(url: string): Permission[] {
  const params = new URL(url).searchParams;
  return JSON.parse(params.get('permissionGroupKeys') ?? '[]') as Permission[];
}

describe('buildCloudflareTokenUrl', () => {
  it('deep-links into the account API token screen with the Polylane name', () => {
    const url = buildCloudflareTokenUrl();
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://dash.cloudflare.com');
    assert.equal(parsed.searchParams.get('to'), '/:account/api-tokens');
    assert.equal(parsed.searchParams.get('name'), 'Polylane');
  });

  it('read-only tokens carry only read permissions', () => {
    const permissions = parsePermissions(buildCloudflareTokenUrl({ readOnly: true }));
    assert.ok(permissions.length > 0);
    for (const permission of permissions) {
      assert.equal(permission.type, 'read');
    }
  });

  it('read-only downgrades edit grants instead of dropping them', () => {
    const readOnly = parsePermissions(buildCloudflareTokenUrl({ readOnly: true }));
    const full = parsePermissions(buildCloudflareTokenUrl());
    assert.ok(full.some((p) => p.key === 'dns' && p.type === 'edit'));
    assert.ok(readOnly.some((p) => p.key === 'dns' && p.type === 'read'));
  });

  it('read-only drops action-only grants (run/send/purge) that have no read equivalent', () => {
    const readOnly = parsePermissions(buildCloudflareTokenUrl({ readOnly: true }));
    const full = parsePermissions(buildCloudflareTokenUrl());
    assert.ok(full.some((p) => p.key === 'cache' && p.type === 'purge'));
    assert.ok(!readOnly.some((p) => p.key === 'cache'));
    assert.ok(full.some((p) => p.key === 'websearch' && p.type === 'run'));
    assert.ok(!readOnly.some((p) => p.key === 'websearch'));
  });

  it('read-only de-duplicates keys that appear with several grant types', () => {
    const readOnly = parsePermissions(buildCloudflareTokenUrl({ readOnly: true }));
    const keys = readOnly.map((p) => p.key);
    assert.equal(new Set(keys).size, keys.length);
    assert.equal(keys.filter((k) => k === 'ai_search').length, 1);
  });

  it('the URL is browser-only sized — callers must never print it to a terminal', () => {
    const url = buildCloudflareTokenUrl({ readOnly: true });
    assert.ok(url.length > 2000);
  });
});
