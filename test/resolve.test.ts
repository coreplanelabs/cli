import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { registry } from '../src/registry';
import { registerAllCommands } from '../src/commands';

registerAllCommands();

describe('command resolution', () => {
  it('resolves case investigate', () => {
    const r = registry.resolve(['case', 'investigate']);
    assert.ok(r);
    assert.equal(r.command.name, 'case investigate');
  });

  it('resolves service logs', () => {
    const r = registry.resolve(['service', 'logs']);
    assert.ok(r);
    assert.equal(r.command.name, 'service logs');
  });

  it('resolves api call', () => {
    const r = registry.resolve(['api', 'call']);
    assert.ok(r);
    assert.equal(r.command.name, 'api call');
  });

  it('returns null for unknown paths', () => {
    assert.equal(registry.resolve(['unknown']), null);
    assert.equal(registry.resolve(['case', 'nope']), null);
  });

  it('has all resource groups', () => {
    const groups = registry.getResourceGroups();
    const names = groups.map((g) => g.resource).sort();
    assert.deepEqual(names, [
      'api',
      'auth',
      'automation',
      'case',
      'cloud',
      'config',
      'help',
      'integration',
      'memory',
      'repo',
      'service',
      'skill',
      'telemetry',
      'thread',
      'update',
      'wiki',
      'workspace',
    ]);
  });

  it('case group has 6 commands', () => {
    const node = registry.resolveNode(['case']);
    assert.ok(node);
    const subs = registry.getSubcommands(node);
    assert.equal(subs.length, 6);
  });
});
