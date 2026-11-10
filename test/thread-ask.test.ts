import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { threadAskCommand } from '../src/commands/thread/ask';
import { mockConfig } from './helpers/config';

type Sent = { method: string; url: string; body: unknown };

const thread = {
  id: 'thrd_1',
  workspaceId: 'ws_1',
  name: '',
  _html_url: 'https://console.example.test/acme/threads/thrd_1',
};

describe('thread ask', () => {
  const originalFetch = globalThis.fetch;
  const originalWrite = process.stdout.write;
  let sent: Sent[] = [];

  before(() => {
    process.stdout.write = ((): boolean => true) as typeof process.stdout.write;
  });

  beforeEach(() => {
    delete process.env.POLYLANE_API_KEY;
    sent = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      sent.push({ method: String(init?.method ?? 'GET'), url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith('/v1/threads')) {
        return Response.json({ success: true, error: null, result: thread }, { status: 201 });
      }
      return Response.json({ success: true, error: null, result: {} }, { status: 202 });
    }) as typeof fetch;
  });

  after(() => {
    globalThis.fetch = originalFetch;
    process.stdout.write = originalWrite;
  });

  it('sends the prompt once, inside the thread create call', async () => {
    const config = mockConfig({ apiKey: 'test-key', apiKeySource: 'flag', workspaceId: 'ws_1' });
    await threadAskCommand.execute(config, {}, { _: ['hello', 'there'], noWait: true });
    assert.deepEqual(sent, [
      {
        method: 'POST',
        url: 'https://api.example.test/v1/threads',
        body: { workspaceId: 'ws_1', prompt: 'hello there', visibility: 'workspace' },
      },
    ]);
  });
});
