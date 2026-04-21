import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseFlags, scanCommandPath } from '../src/args';
import { GLOBAL_OPTIONS } from '../src/command';
import type { OptionDef } from '../src/command';

const commandOptions: OptionDef[] = [
  { flag: '--name <name>', description: 'name', type: 'string' },
  { flag: '--count <n>', description: 'count', type: 'number' },
  { flag: '--enabled', description: 'enabled', type: 'boolean' },
  { flag: '--tag <tag>', description: 'tag', type: 'array' },
];

describe('scanCommandPath', () => {
  it('extracts single-word command', () => {
    const result = scanCommandPath(['help'], GLOBAL_OPTIONS);
    assert.deepEqual(result, ['help']);
  });

  it('extracts multi-word command path', () => {
    const result = scanCommandPath(['workspace', 'list'], GLOBAL_OPTIONS);
    assert.deepEqual(result, ['workspace', 'list']);
  });

  it('skips global flags', () => {
    const result = scanCommandPath(
      ['--output', 'json', 'workspace', 'list'],
      GLOBAL_OPTIONS
    );
    assert.deepEqual(result, ['workspace', 'list']);
  });

  it('handles --flag=value', () => {
    const result = scanCommandPath(
      ['--output=json', 'workspace', 'list'],
      GLOBAL_OPTIONS
    );
    assert.deepEqual(result, ['workspace', 'list']);
  });

  it('stops at --', () => {
    const result = scanCommandPath(['workspace', 'list', '--', 'extra'], GLOBAL_OPTIONS);
    assert.deepEqual(result, ['workspace', 'list']);
  });

  it('returns empty array for no command', () => {
    const result = scanCommandPath(['--help'], GLOBAL_OPTIONS);
    assert.deepEqual(result, []);
  });
});

describe('parseFlags', () => {
  it('parses string flags', () => {
    const { flags } = parseFlags(['--name', 'foo'], commandOptions, []);
    assert.equal(flags.name, 'foo');
  });

  it('parses number flags', () => {
    const { flags } = parseFlags(['--count', '42'], commandOptions, []);
    assert.equal(flags.count, 42);
  });

  it('parses boolean flags', () => {
    const { flags } = parseFlags(['--enabled'], commandOptions, []);
    assert.equal(flags.enabled, true);
  });

  it('parses --flag=value syntax', () => {
    const { flags } = parseFlags(['--name=foo'], commandOptions, []);
    assert.equal(flags.name, 'foo');
  });

  it('parses array flags (repeatable)', () => {
    const { flags } = parseFlags(['--tag', 'a', '--tag', 'b'], commandOptions, []);
    assert.deepEqual(flags.tag, ['a', 'b']);
  });

  it('converts kebab-case to camelCase', () => {
    const opts: OptionDef[] = [{ flag: '--my-flag <v>', description: '', type: 'string' }];
    const { flags } = parseFlags(['--my-flag', 'x'], opts, []);
    assert.equal(flags.myFlag, 'x');
  });

  it('collects positional args', () => {
    const { positional } = parseFlags(['--name', 'foo', 'bar', 'baz'], commandOptions, []);
    assert.deepEqual(positional, ['bar', 'baz']);
  });

  it('throws on unknown flags', () => {
    assert.throws(() => parseFlags(['--unknown'], commandOptions, []));
  });

  it('throws when required value is missing', () => {
    assert.throws(() => parseFlags(['--name'], commandOptions, []));
  });

  it('pass-through after --', () => {
    const { positional } = parseFlags(['--', '--something', 'else'], commandOptions, []);
    assert.deepEqual(positional, ['--something', 'else']);
  });
});
