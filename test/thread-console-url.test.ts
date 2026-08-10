import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { threadConsoleUrl, type ThreadUrlApi } from '../src/commands/thread/console-url';
import { mockConfig } from './helpers/config';

const thread = { id: 'thrd_1', workspaceId: 'ws_1' };

describe('threadConsoleUrl', () => {
  beforeEach(() => {
    delete process.env.POLYLANE_CONSOLE_DOMAIN;
  });

  it('prefers the thread _html_url when present', async () => {
    const api: ThreadUrlApi = {
      async workspacesGet() {
        throw new Error('should not be called');
      },
    };
    const url = await threadConsoleUrl(mockConfig(), api, {
      ...thread,
      _html_url: 'https://console.example.test/acme/threads/thrd_1',
    });
    assert.equal(url, 'https://console.example.test/acme/threads/thrd_1');
  });

  it('builds the URL from the workspace slug', async () => {
    const api: ThreadUrlApi = {
      async workspacesGet(id) {
        assert.equal(id, 'ws_1');
        return { slug: 'acme' };
      },
    };
    const url = await threadConsoleUrl(mockConfig(), api, thread);
    assert.equal(url, 'https://console.example.test/acme/threads/thrd_1');
  });

  it('falls back to the console base URL when the workspace lookup fails', async () => {
    const api: ThreadUrlApi = {
      async workspacesGet() {
        throw new Error('boom');
      },
    };
    const url = await threadConsoleUrl(mockConfig(), api, thread);
    assert.equal(url, 'https://console.example.test');
  });
});
