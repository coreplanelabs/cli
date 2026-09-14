import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startReturnListener } from '../src/billing/return-listener';

async function get(url: string): Promise<{ status: number; body: string }> {
  const res = await fetch(url);
  return { status: res.status, body: await res.text() };
}

describe('startReturnListener', () => {
  it('binds an ephemeral loopback port with distinct success and cancel URLs carrying one state', async () => {
    const listener = await startReturnListener();
    assert.ok(listener);
    try {
      const success = new URL(listener.successUrl);
      const cancel = new URL(listener.cancelUrl);
      assert.equal(success.hostname, '127.0.0.1');
      assert.equal(success.port, cancel.port);
      assert.notEqual(success.port, '18991');
      assert.equal(success.pathname, '/billing/return');
      assert.equal(cancel.pathname, '/billing/cancel');
      const state = success.searchParams.get('state');
      assert.ok(state && state.length >= 32);
      assert.equal(cancel.searchParams.get('state'), state);
    } finally {
      listener.close();
    }
  });

  it('resolves success when the success URL is hit, and tolerates the session id Stripe appends', async () => {
    const listener = await startReturnListener();
    assert.ok(listener);
    try {
      const res = await get(`${listener.successUrl}&session_id=cs_test_123`);
      assert.equal(res.status, 200);
      assert.match(res.body, /upgraded/i);
      assert.match(res.body, /return to your terminal/i);
      assert.equal(await listener.outcome, 'success');
    } finally {
      listener.close();
    }
  });

  it('resolves cancel when the cancel URL is hit', async () => {
    const listener = await startReturnListener();
    assert.ok(listener);
    try {
      const res = await get(listener.cancelUrl);
      assert.equal(res.status, 200);
      assert.match(res.body, /canceled/i);
      assert.match(res.body, /Nothing was charged/);
      assert.equal(await listener.outcome, 'cancel');
    } finally {
      listener.close();
    }
  });

  it('ignores requests with a wrong or missing state and unknown paths', async () => {
    const listener = await startReturnListener();
    assert.ok(listener);
    try {
      const base = new URL(listener.successUrl);
      const wrongState = await get(`${base.origin}/billing/return?state=nope`);
      assert.equal(wrongState.status, 404);
      const noState = await get(`${base.origin}/billing/cancel`);
      assert.equal(noState.status, 404);
      const unknown = await get(`${base.origin}/callback?state=${base.searchParams.get('state')}`);
      assert.equal(unknown.status, 404);
      // Still unsettled: a valid hit afterwards decides it.
      let settled = false;
      void listener.outcome.then(() => {
        settled = true;
      });
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(settled, false);
      await get(listener.cancelUrl);
      assert.equal(await listener.outcome, 'cancel');
    } finally {
      listener.close();
    }
  });

  it('keeps the first outcome when both URLs are hit', async () => {
    const listener = await startReturnListener();
    assert.ok(listener);
    try {
      await get(listener.cancelUrl);
      await get(listener.successUrl);
      assert.equal(await listener.outcome, 'cancel');
    } finally {
      listener.close();
    }
  });

  it('returns null when the host cannot be bound', async () => {
    const listener = await startReturnListener('192.0.2.1');
    assert.equal(listener, null);
  });
});
