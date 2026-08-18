import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// The baked fallbacks are captured at module load, so the env must be clean
// before src/auth/oauth is imported.
delete process.env.POLYLANE_OAUTH_CLIENT_ID;
delete process.env.POLYLANE_OAUTH_CLIENT_SECRET;

const { oauthClientId, oauthClientSecret } = await import('../src/auth/oauth');

describe('oauth client resolution', () => {
  beforeEach(() => {
    delete process.env.POLYLANE_OAUTH_CLIENT_ID;
    delete process.env.POLYLANE_OAUTH_CLIENT_SECRET;
  });

  it('falls back to the baked defaults without env overrides', () => {
    assert.equal(oauthClientId(), 'polylane-cli');
    assert.equal(oauthClientSecret(), '');
  });

  it('resolves POLYLANE_OAUTH_CLIENT_ID at call time, not import time', () => {
    process.env.POLYLANE_OAUTH_CLIENT_ID = 'oauth_client_uat_override';
    assert.equal(oauthClientId(), 'oauth_client_uat_override');
    delete process.env.POLYLANE_OAUTH_CLIENT_ID;
    assert.equal(oauthClientId(), 'polylane-cli');
  });

  it('resolves POLYLANE_OAUTH_CLIENT_SECRET at call time', () => {
    process.env.POLYLANE_OAUTH_CLIENT_SECRET = 'uat-secret';
    assert.equal(oauthClientSecret(), 'uat-secret');
  });

  it('treats an empty env override as unset', () => {
    process.env.POLYLANE_OAUTH_CLIENT_ID = '';
    assert.equal(oauthClientId(), 'polylane-cli');
  });
});
