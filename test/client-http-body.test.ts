import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const { request } = await import('../src/client/http');
const { mockConfig } = await import('./helpers/config');

type Call = { method: string; contentType: string | null; body: string | undefined };

// The Polylane API edge answers a mutating request without a JSON content type
// with a 403 HTML page before it reaches a worker (nominal#1575). The client
// must therefore send the header and an empty object on every POST, PUT, PATCH
// and DELETE that has no body of its own; GET stays body-less.
describe('request body and content type', () => {
  const originalFetch = globalThis.fetch;
  let calls: Call[] = [];

  before(() => {
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const headers = new Headers(init?.headers as HeadersInit);
      calls.push({ method: String(init?.method), contentType: headers.get('content-type'), body: init?.body === undefined ? undefined : String(init.body) });
      return new Response(JSON.stringify({ message: null, success: true, error: null, result: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
  });
  after(() => {
    globalThis.fetch = originalFetch;
  });
  beforeEach(() => {
    calls = [];
  });

  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
    it(`${method} without a body sends a JSON content type and an empty object`, async () => {
      await request(mockConfig(), { url: '/v1/things/x', method, noAuth: true });
      assert.deepEqual(calls, [{ method, contentType: 'application/json', body: '{}' }]);
    });
  }

  it('a body given by the caller is sent as is', async () => {
    await request(mockConfig(), { url: '/v1/things', method: 'POST', body: { a: 1 }, noAuth: true });
    assert.deepEqual(calls, [{ method: 'POST', contentType: 'application/json', body: '{"a":1}' }]);
  });

  it('GET stays body-less with no content type', async () => {
    await request(mockConfig(), { url: '/v1/things', noAuth: true });
    assert.deepEqual(calls, [{ method: 'GET', contentType: null, body: undefined }]);
  });
});
