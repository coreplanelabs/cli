import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { registry } from '../src/registry';
import { registerAllCommands } from '../src/commands';

registerAllCommands();

describe('command resolution', () => {
  it('resolves issue list', () => {
    const r = registry.resolve(['issue', 'list']);
    assert.ok(r);
    assert.equal(r.command.name, 'issue list');
  });

  it('resolves issue note', () => {
    const r = registry.resolve(['issue', 'note']);
    assert.ok(r);
    assert.equal(r.command.name, 'issue note');
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
    assert.equal(registry.resolve(['issue', 'nope']), null);
  });

  it('has all resource groups', () => {
    const groups = registry.getResourceGroups();
    const names = groups.map((g) => g.resource).sort();
    assert.deepEqual(names, [
      'api',
      'artifact',
      'auth',
      'autofix',
      'automation',
      'cloud',
      'config',
      'feed',
      'help',
      'integration',
      'issue',
      'memory',
      'note',
      'repo',
      'service',
      'skill',
      'telemetry',
      'thread',
      'tools',
      'update',
      'workspace',
    ]);
  });

  it('issue group has 5 commands', () => {
    const node = registry.resolveNode(['issue']);
    assert.ok(node);
    const subs = registry.getSubcommands(node);
    assert.equal(subs.length, 5);
  });
});
