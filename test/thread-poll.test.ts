import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { waitForAssistantReply, extractMessageText, type ThreadPollApi } from '../src/client/thread-poll';
import type { Message } from '../src/generated/types';

function message(role: Message['role'], parts: unknown[], id = `msg_${role}`): Message {
  return { id, role, parts } as unknown as Message;
}

function fakeApi(
  states: Array<{ running: boolean; messages: Message[] }>
): ThreadPollApi {
  let calls = 0;
  const current = (): { running: boolean; messages: Message[] } =>
    states[Math.min(calls, states.length - 1)]!;
  return {
    async threadsGet() {
      const state = current();
      calls++;
      return {
        thread: {
          runningSince: state.running ? new Date().toISOString() : null,
          awaitingAgentsSince: null,
        },
      };
    },
    async messagesList() {
      return { items: [...current().messages].reverse() };
    },
  };
}

describe('extractMessageText', () => {
  it('joins text parts and skips non-text parts', () => {
    const msg = message('assistant', [
      { type: 'text', text: 'first' },
      { type: 'tool-call', toolName: 'x' },
      null,
      { type: 'text', text: 'second' },
    ]);
    assert.equal(extractMessageText(msg), 'first\n\nsecond');
  });

  it('returns empty for null parts', () => {
    assert.equal(extractMessageText(message('assistant', null as unknown as unknown[])), '');
  });
});

describe('waitForAssistantReply', () => {
  it('completes once the thread is idle with an assistant reply', async () => {
    const user = message('user', [{ type: 'text', text: 'question' }]);
    const reply = message('assistant', [{ type: 'text', text: 'answer' }]);
    const api = fakeApi([
      { running: false, messages: [user] },
      { running: true, messages: [user] },
      { running: false, messages: [user, reply] },
    ]);
    const result = await waitForAssistantReply(api, 'ws_x', 'thrd_x', { intervalMs: 1 });
    assert.equal(result.status, 'complete');
    assert.equal(result.text, 'answer');
    assert.equal(result.assistantMessages.length, 1);
  });

  it('keeps waiting while the thread is idle before the turn starts', async () => {
    const user = message('user', [{ type: 'text', text: 'question' }]);
    const reply = message('assistant', [{ type: 'text', text: 'late answer' }]);
    const api = fakeApi([
      { running: false, messages: [] },
      { running: false, messages: [user] },
      { running: false, messages: [user, reply] },
    ]);
    const result = await waitForAssistantReply(api, 'ws_x', 'thrd_x', { intervalMs: 1 });
    assert.equal(result.status, 'complete');
    assert.equal(result.text, 'late answer');
  });

  it('completes without text after repeated idle polls once the turn ran', async () => {
    const user = message('user', [{ type: 'text', text: 'question' }]);
    const api = fakeApi([
      { running: true, messages: [user] },
      { running: false, messages: [user] },
    ]);
    const result = await waitForAssistantReply(api, 'ws_x', 'thrd_x', { intervalMs: 1 });
    assert.equal(result.status, 'complete');
    assert.equal(result.text, '');
  });

  it('times out and reports partial text', async () => {
    const user = message('user', [{ type: 'text', text: 'question' }]);
    const partial = message('assistant', [{ type: 'text', text: 'partial' }]);
    const api = fakeApi([{ running: true, messages: [user, partial] }]);
    const result = await waitForAssistantReply(api, 'ws_x', 'thrd_x', {
      intervalMs: 1,
      timeoutMs: 20,
      onText: () => {},
    });
    assert.equal(result.status, 'timeout');
    assert.equal(result.text, 'partial');
  });

  it('ignores pre-existing messages when ignoreIds is set', async () => {
    const oldUser = message('user', [{ type: 'text', text: 'first question' }], 'msg_1');
    const oldReply = message('assistant', [{ type: 'text', text: 'first answer' }], 'msg_2');
    const newUser = message('user', [{ type: 'text', text: 'follow-up' }], 'msg_3');
    const newReply = message('assistant', [{ type: 'text', text: 'second answer' }], 'msg_4');
    const api = fakeApi([
      { running: false, messages: [oldUser, oldReply] },
      { running: true, messages: [oldUser, oldReply, newUser] },
      { running: false, messages: [oldUser, oldReply, newUser, newReply] },
    ]);
    const result = await waitForAssistantReply(api, 'ws_x', 'thrd_x', {
      intervalMs: 1,
      ignoreIds: new Set(['msg_1', 'msg_2']),
    });
    assert.equal(result.status, 'complete');
    assert.equal(result.text, 'second answer');
    assert.equal(result.assistantMessages.length, 1);
  });

  it('emits incremental deltas while streaming', async () => {
    const user = message('user', [{ type: 'text', text: 'question' }]);
    const api = fakeApi([
      { running: true, messages: [user, message('assistant', [{ type: 'text', text: 'Hel' }])] },
      { running: true, messages: [user, message('assistant', [{ type: 'text', text: 'Hello wor' }])] },
      { running: false, messages: [user, message('assistant', [{ type: 'text', text: 'Hello world' }])] },
    ]);
    const chunks: string[] = [];
    const result = await waitForAssistantReply(api, 'ws_x', 'thrd_x', {
      intervalMs: 1,
      onText: (delta) => chunks.push(delta),
    });
    assert.equal(result.status, 'complete');
    assert.equal(chunks.join(''), 'Hello world');
    assert.ok(chunks.length > 1);
  });
});
