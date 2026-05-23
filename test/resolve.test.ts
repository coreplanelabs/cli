import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { registry } from '../src/registry';
import { registerAllCommands } from '../src/commands';

registerAllCommands();

describe('command resolution', () => {
  it('resolves anomaly list', () => {
    const r = registry.resolve(['anomaly', 'list']);
    assert.ok(r);
    assert.equal(r.command.name, 'anomaly list');
  });

  it('resolves incident note', () => {
    const r = registry.resolve(['incident', 'note']);
    assert.ok(r);
    assert.equal(r.command.name, 'incident note');
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
    assert.equal(registry.resolve(['anomaly', 'nope']), null);
  });

  it('has all resource groups', () => {
    const groups = registry.getResourceGroups();
    const names = groups.map((g) => g.resource).sort();
    assert.deepEqual(names, [
      'anomaly',
      'api',
      'artifact',
      'auth',
      'autofix',
      'automation',
      'cloud',
      'config',
      'help',
      'incident',
      'integration',
      'memory',
      'note',
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

  it('anomaly group has 2 commands', () => {
    const node = registry.resolveNode(['anomaly']);
    assert.ok(node);
    const subs = registry.getSubcommands(node);
    assert.equal(subs.length, 2);
  });
});
