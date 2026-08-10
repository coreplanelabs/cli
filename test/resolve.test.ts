import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { registry } from '../src/registry';
import { registerAllCommands } from '../src/commands';
import { helpCommand } from '../src/commands/help';
import { setupCommand } from '../src/commands/setup';
import { CLIError } from '../src/errors/base';
import { ExitCode } from '../src/errors/codes';
import { mockConfig } from './helpers/config';

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
      'scan',
      'service',
      'setup',
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

describe('unknown command handling', () => {
  it('help throws a concise usage error instead of dumping root help', async () => {
    const written: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      await assert.rejects(
        helpCommand.execute(mockConfig(), {}, { _: ['nope', 'sub'] }),
        (err: unknown) => {
          assert.ok(err instanceof CLIError);
          assert.equal(err.message, 'Unknown command: polylane nope sub');
          assert.equal(err.exitCode, ExitCode.USAGE);
          assert.ok(err.hint?.includes('polylane --help'));
          return true;
        }
      );
    } finally {
      process.stdout.write = origWrite;
    }
    assert.deepEqual(written, []);
  });
});

describe('setup failure copy', () => {
  it('rejects an unknown agent with the supported list', async () => {
    await assert.rejects(
      setupCommand.execute(mockConfig(), {}, { _: [], agent: ['emacs'] }),
      (err: unknown) => {
        assert.ok(err instanceof CLIError);
        assert.equal(err.message, 'Unknown agent: "emacs"');
        assert.equal(err.exitCode, ExitCode.USAGE);
        assert.ok(err.hint?.includes('claude'));
        return true;
      }
    );
  });
});
