import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CommandRegistry } from '../src/registry';
import type { Command } from '../src/command';

const makeCmd = (name: string): Command => ({
  name,
  description: `desc for ${name}`,
  async execute() {},
});

describe('CommandRegistry', () => {
  it('registers and resolves a simple command', () => {
    const r = new CommandRegistry();
    const cmd = makeCmd('foo');
    r.register(cmd);
    const resolved = r.resolve(['foo']);
    assert.ok(resolved);
    assert.equal(resolved.command.name, 'foo');
    assert.equal(resolved.consumed, 1);
  });

  it('resolves a nested command', () => {
    const r = new CommandRegistry();
    r.register(makeCmd('workspace list'));
    r.register(makeCmd('workspace get'));
    const resolved = r.resolve(['workspace', 'list']);
    assert.ok(resolved);
    assert.equal(resolved.command.name, 'workspace list');
    assert.equal(resolved.consumed, 2);
  });

  it('returns null for unknown commands', () => {
    const r = new CommandRegistry();
    r.register(makeCmd('foo'));
    assert.equal(r.resolve(['bar']), null);
  });

  it('auto-forwards single child', () => {
    const r = new CommandRegistry();
    r.register(makeCmd('only sub'));
    const resolved = r.resolve(['only']);
    assert.ok(resolved);
    assert.equal(resolved.command.name, 'only sub');
  });

  it('groups commands by first path segment', () => {
    const r = new CommandRegistry();
    r.register(makeCmd('workspace list'));
    r.register(makeCmd('workspace get'));
    r.register(makeCmd('auth login'));
    const groups = r.getResourceGroups();
    assert.equal(groups.length, 2);
    const byName = new Map(groups.map((g) => [g.resource, g.commands.length]));
    assert.equal(byName.get('workspace'), 2);
    assert.equal(byName.get('auth'), 1);
  });
});
