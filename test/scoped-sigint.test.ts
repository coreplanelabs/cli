import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scopedSigint } from '../src/commands/helpers';

describe('scopedSigint', () => {
  it('displaces earlier SIGINT listeners while active and restores them afterwards', () => {
    const before = process.listeners('SIGINT');
    process.removeAllListeners('SIGINT');
    const calls: string[] = [];
    const global = () => calls.push('global');
    process.on('SIGINT', global);

    const restore = scopedSigint(() => calls.push('scoped'));
    process.emit('SIGINT');
    assert.deepEqual(calls, ['scoped']);

    restore();
    process.emit('SIGINT');
    assert.deepEqual(calls, ['scoped', 'global']);

    process.removeAllListeners('SIGINT');
    for (const listener of before) process.on('SIGINT', listener as (...args: unknown[]) => void);
  });
});
