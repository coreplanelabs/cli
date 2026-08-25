import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { parse as parseJsonc, type ParseError } from 'jsonc-parser';
import type { Config } from '../src/config/schema';
import {
  AGENTS,
  writeSkillFile,
  upsertJsonEntry,
  upsertJsoncEntry,
  opencodeConfigFile,
  upsertTomlSection,
  upsertGooseExtension,
  vscodeUserDirectory,
  hasAgentFootprint,
  detectedAgents,
  detectedAgentIds,
  SKILLS_SH_IDS,
  setupCommand,
  MCP_SERVER_NAME,
  MCP_SERVER_URL,
  decidePrimaryAgent,
} from '../src/commands/setup';
import { SKILL_MD } from '../src/generated/skill';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'polylane-setup-test-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function agent(id: string) {
  const found = AGENTS.find((a) => a.id === id);
  assert.ok(found, `agent ${id} is defined`);
  return found;
}

// A directory with a config file in it — what an installed agent looks like.
// Returns the path of the file written, so callers can overwrite it.
function seedDir(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'settings.json');
  writeFileSync(file, '{}', 'utf-8');
  return file;
}

describe('writeSkillFile', () => {
  it('creates the skill file with the bundled content', () => {
    const path = join(tempDir, '.claude', 'skills', 'polylane-cli', 'SKILL.md');
    const result = writeSkillFile(path);
    assert.equal(result.action, 'created');
    assert.equal(readFileSync(path, 'utf-8'), SKILL_MD);
  });

  it('reports unchanged when the installed skill matches', () => {
    const path = join(tempDir, 'SKILL.md');
    writeSkillFile(path);
    assert.equal(writeSkillFile(path).action, 'unchanged');
  });

  it('overwrites a stale skill file', () => {
    const path = join(tempDir, 'SKILL.md');
    writeFileSync(path, 'old skill content', 'utf-8');
    const result = writeSkillFile(path);
    assert.equal(result.action, 'updated');
    assert.equal(readFileSync(path, 'utf-8'), SKILL_MD);
  });

  it('does not write in dry-run mode', () => {
    const path = join(tempDir, 'SKILL.md');
    const result = writeSkillFile(path, true);
    assert.equal(result.action, 'created');
    assert.equal(existsSync(path), false);
  });
});

describe('upsertJsonEntry', () => {
  it('creates the file and nested key path', () => {
    const path = join(tempDir, 'nested', '.claude.json');
    const result = upsertJsonEntry(path, ['mcpServers', MCP_SERVER_NAME], { type: 'http', url: MCP_SERVER_URL });
    assert.equal(result.action, 'created');
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as {
      mcpServers: Record<string, unknown>;
    };
    assert.deepEqual(parsed.mcpServers[MCP_SERVER_NAME], { type: 'http', url: MCP_SERVER_URL });
  });

  it('preserves unrelated keys and servers', () => {
    const path = join(tempDir, 'config.json');
    writeFileSync(
      path,
      JSON.stringify({
        theme: 'dark',
        mcpServers: { other: { type: 'http', url: 'https://example.com/mcp' } },
      }),
      'utf-8'
    );
    const result = upsertJsonEntry(path, ['mcpServers', MCP_SERVER_NAME], { type: 'http', url: MCP_SERVER_URL });
    assert.equal(result.action, 'updated');
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as {
      theme: string;
      mcpServers: Record<string, unknown>;
    };
    assert.equal(parsed.theme, 'dark');
    assert.deepEqual(parsed.mcpServers.other, { type: 'http', url: 'https://example.com/mcp' });
    assert.deepEqual(parsed.mcpServers[MCP_SERVER_NAME], { type: 'http', url: MCP_SERVER_URL });
  });

  it('leaves an existing entry untouched', () => {
    const path = join(tempDir, 'config.json');
    const original = JSON.stringify({
      mcpServers: { [MCP_SERVER_NAME]: { type: 'http', url: MCP_SERVER_URL, headers: { 'x-api-key': 'sk_custom' } } },
    });
    writeFileSync(path, original, 'utf-8');
    const result = upsertJsonEntry(path, ['mcpServers', MCP_SERVER_NAME], { type: 'http', url: MCP_SERVER_URL });
    assert.equal(result.action, 'unchanged');
    assert.equal(readFileSync(path, 'utf-8'), original);
  });

  it('skips and leaves the file alone when it is not valid JSON', () => {
    const path = join(tempDir, 'settings.json');
    writeFileSync(path, '// zed settings\n{ "theme": "dark", }', 'utf-8');
    const result = upsertJsonEntry(path, ['context_servers', MCP_SERVER_NAME], {});
    assert.equal(result.action, 'skipped');
    assert.ok(result.detail);
    assert.equal(readFileSync(path, 'utf-8'), '// zed settings\n{ "theme": "dark", }');
  });

  it('skips when the file holds a JSON array instead of an object', () => {
    const path = join(tempDir, 'config.json');
    writeFileSync(path, '[]', 'utf-8');
    assert.equal(upsertJsonEntry(path, ['mcpServers', MCP_SERVER_NAME], {}).action, 'skipped');
  });

  it('skips when an intermediate key is not an object', () => {
    const path = join(tempDir, 'config.json');
    writeFileSync(path, JSON.stringify({ mcpServers: 'oops' }), 'utf-8');
    assert.equal(upsertJsonEntry(path, ['mcpServers', MCP_SERVER_NAME], {}).action, 'skipped');
  });

  it('does not write in dry-run mode', () => {
    const path = join(tempDir, 'config.json');
    const result = upsertJsonEntry(path, ['mcpServers', MCP_SERVER_NAME], {}, true);
    assert.equal(result.action, 'created');
    assert.equal(existsSync(path), false);
  });
});

describe('upsertJsoncEntry', () => {
  const ENTRY = { type: 'remote', url: MCP_SERVER_URL };

  it('creates the file and nested key path', () => {
    const path = join(tempDir, 'opencode.json');
    const result = upsertJsoncEntry(path, ['mcp', MCP_SERVER_NAME], ENTRY);
    assert.equal(result.action, 'created');
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as { mcp: Record<string, unknown> };
    assert.deepEqual(parsed.mcp[MCP_SERVER_NAME], ENTRY);
  });

  function parseOpencode(path: string): { mcp?: Record<string, unknown> } {
    const errors: ParseError[] = [];
    const parsed = parseJsonc(readFileSync(path, 'utf-8'), errors, { allowTrailingComma: true }) as {
      mcp?: Record<string, unknown>;
    };
    assert.equal(errors.length, 0, 'edited file parses as JSONC');
    return parsed;
  }

  it('inserts into a commented file without touching the comments', () => {
    const path = join(tempDir, 'opencode.jsonc');
    writeFileSync(
      path,
      '{\n  // my theme\n  "theme": "dark", // trailing\n  /* block */\n  "autoupdate": true,\n}\n',
      'utf-8'
    );
    const result = upsertJsoncEntry(path, ['mcp', MCP_SERVER_NAME], ENTRY);
    assert.equal(result.action, 'updated');
    const content = readFileSync(path, 'utf-8');
    assert.ok(content.includes('// my theme'));
    assert.ok(content.includes('// trailing'));
    assert.ok(content.includes('/* block */'));
    assert.ok(content.includes('"autoupdate": true,'));
    assert.deepEqual(parseOpencode(path).mcp?.[MCP_SERVER_NAME], ENTRY);
  });

  it('edits a heavily commented config with trailing commas everywhere', () => {
    const path = join(tempDir, 'opencode.jsonc');
    writeFileSync(
      path,
      [
        '// opencode config',
        '{',
        '  "$schema": "https://opencode.ai/config.json", // schema',
        '  /* providers',
        '     multi-line */',
        '  "provider": {',
        '    "anthropic": { "options": { "timeout": 600000, }, },',
        '  }, // end providers',
        '  "instructions": ["docs/*.md",],',
        '}',
        '// eof',
        '',
      ].join('\n'),
      'utf-8'
    );
    const result = upsertJsoncEntry(path, ['mcp', MCP_SERVER_NAME], ENTRY);
    assert.equal(result.action, 'updated');
    const content = readFileSync(path, 'utf-8');
    for (const kept of ['// opencode config', '/* providers', '// end providers', '"docs/*.md",', '// eof']) {
      assert.ok(content.includes(kept), `kept: ${kept}`);
    }
    assert.deepEqual(parseOpencode(path).mcp?.[MCP_SERVER_NAME], ENTRY);
  });

  it('inserts into an existing mcp object, keeping sibling servers', () => {
    const path = join(tempDir, 'opencode.jsonc');
    writeFileSync(
      path,
      '{\n  "mcp": {\n    // local server\n    "other": { "type": "local", "command": ["run"] },\n  },\n}\n',
      'utf-8'
    );
    const result = upsertJsoncEntry(path, ['mcp', MCP_SERVER_NAME], ENTRY);
    assert.equal(result.action, 'updated');
    const content = readFileSync(path, 'utf-8');
    assert.ok(content.includes('// local server'));
    assert.ok(content.includes(`"${MCP_SERVER_NAME}": {`));
    assert.ok(content.indexOf(MCP_SERVER_NAME) < content.indexOf('other'));
  });

  it('edits a plain-JSON file in place without reformatting it', () => {
    const path = join(tempDir, 'opencode.json');
    const original = '{\n  "theme": "dark"\n}\n';
    writeFileSync(path, original, 'utf-8');
    const result = upsertJsoncEntry(path, ['mcp', MCP_SERVER_NAME], ENTRY);
    assert.equal(result.action, 'updated');
    const content = readFileSync(path, 'utf-8');
    assert.ok(content.includes('"theme": "dark"'));
    const parsed = JSON.parse(content) as { theme: string; mcp: Record<string, unknown> };
    assert.equal(parsed.theme, 'dark');
    assert.deepEqual(parsed.mcp[MCP_SERVER_NAME], ENTRY);
  });

  it('leaves an existing entry untouched, comments included', () => {
    const path = join(tempDir, 'opencode.jsonc');
    const original = `{\n  // keep me\n  "mcp": { "${MCP_SERVER_NAME}": { "type": "remote", "url": "${MCP_SERVER_URL}", "headers": { "x-api-key": "sk" } } },\n}\n`;
    writeFileSync(path, original, 'utf-8');
    assert.equal(upsertJsoncEntry(path, ['mcp', MCP_SERVER_NAME], ENTRY).action, 'unchanged');
    assert.equal(readFileSync(path, 'utf-8'), original);
  });

  it('skips only a genuinely malformed file, leaving it untouched', () => {
    const path = join(tempDir, 'opencode.jsonc');
    writeFileSync(path, '{ "theme": ', 'utf-8');
    const result = upsertJsoncEntry(path, ['mcp', MCP_SERVER_NAME], ENTRY);
    assert.equal(result.action, 'skipped');
    assert.equal(result.needsManualStep, true);
    assert.equal(result.detail, 'existing file is not valid JSONC');
    assert.equal(readFileSync(path, 'utf-8'), '{ "theme": ');
  });

  it('skips when mcp is not an object', () => {
    const path = join(tempDir, 'opencode.jsonc');
    writeFileSync(path, '// c\n{ "mcp": "oops" }', 'utf-8');
    const result = upsertJsoncEntry(path, ['mcp', MCP_SERVER_NAME], ENTRY);
    assert.equal(result.action, 'skipped');
    assert.equal(readFileSync(path, 'utf-8'), '// c\n{ "mcp": "oops" }');
  });

  it('treats single-quoted strings as malformed, like opencode does', () => {
    const path = join(tempDir, 'opencode.jsonc');
    writeFileSync(path, "{ 'theme': 'dark' }", 'utf-8');
    const result = upsertJsoncEntry(path, ['mcp', MCP_SERVER_NAME], ENTRY);
    assert.equal(result.action, 'skipped');
    assert.equal(readFileSync(path, 'utf-8'), "{ 'theme': 'dark' }");
  });

  it('does not report unchanged for a top-level key that only matches the leaf name', () => {
    const path = join(tempDir, 'opencode.jsonc');
    writeFileSync(path, `{ "${MCP_SERVER_NAME}": true }`, 'utf-8');
    const result = upsertJsoncEntry(path, ['mcp', MCP_SERVER_NAME], ENTRY);
    assert.equal(result.action, 'updated');
    assert.deepEqual(parseOpencode(path).mcp?.[MCP_SERVER_NAME], ENTRY);
  });

  it('handles an empty root object', () => {
    const path = join(tempDir, 'opencode.jsonc');
    writeFileSync(path, '{}\n', 'utf-8');
    assert.equal(upsertJsoncEntry(path, ['mcp', MCP_SERVER_NAME], ENTRY).action, 'updated');
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as { mcp: Record<string, unknown> };
    assert.deepEqual(parsed.mcp[MCP_SERVER_NAME], ENTRY);
  });

  it('ignores braces and slashes inside strings', () => {
    const path = join(tempDir, 'opencode.jsonc');
    writeFileSync(path, '{\n  // note\n  "instructions": ["a {weird} // path \\" (}"],\n}\n', 'utf-8');
    const result = upsertJsoncEntry(path, ['mcp', MCP_SERVER_NAME], ENTRY);
    assert.equal(result.action, 'updated');
    const content = readFileSync(path, 'utf-8');
    assert.ok(content.includes('"a {weird} // path \\" (}"'));
  });

  it('does not write in dry-run mode', () => {
    const created = upsertJsoncEntry(join(tempDir, 'opencode.json'), ['mcp', MCP_SERVER_NAME], ENTRY, true);
    assert.equal(created.action, 'created');
    assert.equal(existsSync(join(tempDir, 'opencode.json')), false);
    const path = join(tempDir, 'opencode.jsonc');
    const original = '{\n  // c\n  "theme": "dark",\n}\n';
    writeFileSync(path, original, 'utf-8');
    assert.equal(upsertJsoncEntry(path, ['mcp', MCP_SERVER_NAME], ENTRY, true).action, 'updated');
    assert.equal(readFileSync(path, 'utf-8'), original);
  });
});

describe('opencodeConfigFile', () => {
  it('targets an existing opencode.jsonc over creating opencode.json', () => {
    writeFileSync(join(tempDir, 'opencode.jsonc'), '{}\n', 'utf-8');
    assert.equal(opencodeConfigFile(tempDir), join(tempDir, 'opencode.jsonc'));
  });

  it('defaults to opencode.json when no variant exists', () => {
    assert.equal(opencodeConfigFile(tempDir), join(tempDir, 'opencode.json'));
  });
});

describe('upsertTomlSection', () => {
  const header = `[mcp_servers.${MCP_SERVER_NAME}]`;
  const body = `url = "${MCP_SERVER_URL}"\n`;

  it('creates the file with the section', () => {
    const path = join(tempDir, '.codex', 'config.toml');
    const result = upsertTomlSection(path, header, body);
    assert.equal(result.action, 'created');
    assert.equal(readFileSync(path, 'utf-8'), `${header}\n${body}`);
  });

  it('appends to an existing file without touching its content', () => {
    const path = join(tempDir, 'config.toml');
    writeFileSync(path, 'model = "gpt-5"\n', 'utf-8');
    const result = upsertTomlSection(path, header, body);
    assert.equal(result.action, 'updated');
    const content = readFileSync(path, 'utf-8');
    assert.ok(content.startsWith('model = "gpt-5"\n'));
    assert.ok(content.includes(`${header}\n${body}`));
  });

  it('reports unchanged when the section is already present', () => {
    const path = join(tempDir, 'config.toml');
    upsertTomlSection(path, header, body);
    const before = readFileSync(path, 'utf-8');
    assert.equal(upsertTomlSection(path, header, body).action, 'unchanged');
    assert.equal(readFileSync(path, 'utf-8'), before);
  });
});

describe('upsertGooseExtension', () => {
  it('creates config.yaml with the extensions block', () => {
    const path = join(tempDir, '.config', 'goose', 'config.yaml');
    const result = upsertGooseExtension(path);
    assert.equal(result.action, 'created');
    const yaml = readFileSync(path, 'utf-8');
    assert.ok(yaml.startsWith(`extensions:\n  ${MCP_SERVER_NAME}:\n`));
  });

  it('inserts under an existing extensions block without touching other entries', () => {
    const path = join(tempDir, 'config.yaml');
    writeFileSync(path, 'GOOSE_PROVIDER: anthropic\nextensions:\n  developer:\n    enabled: true\n    type: builtin\n', 'utf-8');
    const result = upsertGooseExtension(path);
    assert.equal(result.action, 'updated');
    const yaml = readFileSync(path, 'utf-8');
    assert.ok(yaml.startsWith('GOOSE_PROVIDER: anthropic\n'));
    assert.ok(yaml.includes(`extensions:\n  ${MCP_SERVER_NAME}:\n`));
    assert.ok(yaml.includes('  developer:\n    enabled: true\n    type: builtin\n'));
  });

  it('appends an extensions block when the file has none', () => {
    const path = join(tempDir, 'config.yaml');
    writeFileSync(path, 'GOOSE_PROVIDER: anthropic\n', 'utf-8');
    assert.equal(upsertGooseExtension(path).action, 'updated');
    assert.ok(readFileSync(path, 'utf-8').includes(`\nextensions:\n  ${MCP_SERVER_NAME}:\n`));
  });

  it('reports unchanged when the entry is already present', () => {
    const path = join(tempDir, 'config.yaml');
    upsertGooseExtension(path);
    const before = readFileSync(path, 'utf-8');
    assert.equal(upsertGooseExtension(path).action, 'unchanged');
    assert.equal(readFileSync(path, 'utf-8'), before);
  });

  it('skips when extensions is inline YAML', () => {
    const path = join(tempDir, 'config.yaml');
    writeFileSync(path, 'extensions: {}\n', 'utf-8');
    const result = upsertGooseExtension(path);
    assert.equal(result.action, 'skipped');
    assert.equal(readFileSync(path, 'utf-8'), 'extensions: {}\n');
  });

  it('does not write in dry-run mode', () => {
    const path = join(tempDir, 'config.yaml');
    const result = upsertGooseExtension(path, true);
    assert.equal(result.action, 'created');
    assert.equal(existsSync(path), false);
  });
});

describe('agent definitions', () => {
  it('covers the supported agent list', () => {
    assert.deepEqual(
      AGENTS.map((a) => a.id),
      ['claude', 'cursor', 'opencode', 'codex', 'pi', 'warp', 'cline', 'roo', 'goose', 'gemini', 'windsurf', 'zed', 'vscode']
    );
  });

  it('detects agents from their home directories', () => {
    assert.equal(agent('claude').detect(tempDir), false);
    seedDir(join(tempDir, '.claude'));
    assert.equal(agent('claude').detect(tempDir), true);

    assert.equal(agent('codex').detect(tempDir), false);
    seedDir(join(tempDir, '.codex'));
    assert.equal(agent('codex').detect(tempDir), true);

    assert.equal(agent('windsurf').detect(tempDir), false);
    seedDir(join(tempDir, '.codeium', 'windsurf'));
    assert.equal(agent('windsurf').detect(tempDir), true);

    assert.equal(agent('pi').detect(tempDir), false);
    seedDir(join(tempDir, '.pi'));
    assert.equal(agent('pi').detect(tempDir), true);

    assert.equal(agent('warp').detect(tempDir), false);
    seedDir(join(tempDir, '.warp'));
    assert.equal(agent('warp').detect(tempDir), true);

    assert.equal(agent('cline').detect(tempDir), false);
    seedDir(join(tempDir, '.cline'));
    assert.equal(agent('cline').detect(tempDir), true);

    assert.equal(agent('vscode').detect(tempDir), false);
    seedDir(vscodeUserDirectory(tempDir));
    assert.equal(agent('vscode').detect(tempDir), true);

    assert.equal(agent('roo').detect(tempDir), false);
    mkdirSync(join(vscodeUserDirectory(tempDir), 'globalStorage', 'rooveterinaryinc.roo-cline'), { recursive: true });
    assert.equal(agent('roo').detect(tempDir), true);

    assert.equal(agent('goose').detect(tempDir), false);
    seedDir(join(tempDir, '.config', 'goose'));
    assert.equal(agent('goose').detect(tempDir), true);

    assert.equal(agent('gemini').detect(tempDir), false);
    seedDir(join(tempDir, '.gemini'));
    assert.equal(agent('gemini').detect(tempDir), true);
  });

  // skills.sh writes <agent dir>/skills/<skill>/SKILL.md for agents it
  // installs to — with -y and nothing detected, for every agent it knows. A
  // directory holding nothing but skills is skills.sh's footprint, not the
  // agent's, and must not make `polylane setup` believe the agent is installed.
  it('ignores directories that hold nothing but a skills tree', () => {
    writeFileSync(seedDir(join(tempDir, '.cursor', 'skills', 'polylane-cli')), '# skill', 'utf-8');
    assert.equal(agent('cursor').detect(tempDir), false);

    writeFileSync(seedDir(join(tempDir, '.pi', 'agent', 'skills', 'polylane-cli')), '# skill', 'utf-8');
    assert.equal(agent('pi').detect(tempDir), false);
    writeFileSync(join(tempDir, '.pi', 'agent', 'mcp.json'), '{}', 'utf-8');
    assert.equal(agent('pi').detect(tempDir), true);

    seedDir(join(tempDir, '.claude', 'skills', 'polylane-cli'));
    assert.equal(agent('claude').detect(tempDir), false);

    seedDir(join(tempDir, '.cline', 'skills', 'polylane-cli'));
    assert.equal(agent('cline').detect(tempDir), false);
    seedDir(join(tempDir, '.cline', 'data', 'settings'));
    assert.equal(agent('cline').detect(tempDir), true);

    seedDir(join(tempDir, '.codex', 'skills', 'polylane-cli'));
    assert.equal(agent('codex').detect(tempDir), false);
    seedDir(join(tempDir, '.gemini', 'antigravity', 'skills', 'x'));
    assert.equal(agent('gemini').detect(tempDir), false);
  });

  it('hasAgentFootprint: files count, skills trees do not, nested config does', () => {
    assert.equal(hasAgentFootprint(join(tempDir, 'missing')), false);
    mkdirSync(join(tempDir, 'empty'));
    assert.equal(hasAgentFootprint(join(tempDir, 'empty')), false);
    mkdirSync(join(tempDir, 'only-skills', 'skills', 'a', 'b'), { recursive: true });
    writeFileSync(join(tempDir, 'only-skills', 'skills', 'a', 'b', 'SKILL.md'), '#', 'utf-8');
    assert.equal(hasAgentFootprint(join(tempDir, 'only-skills')), false);
    mkdirSync(join(tempDir, 'deep', 'agent', 'skills'), { recursive: true });
    mkdirSync(join(tempDir, 'deep', 'agent', 'sessions', 'x'), { recursive: true });
    assert.equal(hasAgentFootprint(join(tempDir, 'deep')), false);
    writeFileSync(join(tempDir, 'deep', 'agent', 'sessions', 'x', 'log'), '', 'utf-8');
    assert.equal(hasAgentFootprint(join(tempDir, 'deep')), true);
  });

  it('detectedAgents lists installed agents in registry order and ignores skills-only dirs', () => {
    assert.deepEqual(detectedAgents(tempDir), []);
    seedDir(join(tempDir, '.codex'));
    seedDir(join(tempDir, '.pi', 'agent', 'skills', 'x'));
    writeFileSync(join(tempDir, '.claude.json'), '{}', 'utf-8');
    assert.deepEqual(
      detectedAgents(tempDir).map((a) => a.id),
      ['claude', 'codex']
    );
  });

  it('every registry agent has a skills.sh id decision', () => {
    assert.deepEqual(Object.keys(SKILLS_SH_IDS).sort(), AGENTS.map((a) => a.id).sort());
  });

  it('detectedAgentIds translates to skills.sh ids and omits agents skills.sh does not know', () => {
    writeFileSync(join(tempDir, '.claude.json'), '{}', 'utf-8');
    seedDir(join(tempDir, '.gemini'));
    seedDir(join(tempDir, '.cline'));
    seedDir(vscodeUserDirectory(tempDir));
    assert.deepEqual(detectedAgentIds(tempDir, 'polylane'), ['claude', 'cline', 'gemini', 'vscode']);
    assert.deepEqual(detectedAgentIds(tempDir, 'skills-sh'), ['claude-code', 'cline', 'gemini-cli']);
    assert.deepEqual(detectedAgentIds(join(tempDir, 'nowhere'), 'skills-sh'), []);
  });

  async function captureListDetected(
    args: Record<string, unknown>,
    output: 'text' | 'json' = 'text'
  ): Promise<string[]> {
    const lines: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      await setupCommand.execute(
        { output, quiet: false, dryRun: false } as unknown as Config,
        {} as never,
        { listDetected: true, ...args }
      );
    } finally {
      process.stdout.write = original;
    }
    return lines;
  }

  it('setup --list-detected prints one detected id per line and writes nothing', async () => {
    assert.deepEqual(await captureListDetected({}), detectedAgentIds(homedir(), 'polylane').map((id) => id + '\n'));
  });

  it('setup --list-detected --ids skills-sh prints skills.sh ids; an unknown namespace is a usage error', async () => {
    assert.deepEqual(
      await captureListDetected({ ids: 'skills-sh' }),
      detectedAgentIds(homedir(), 'skills-sh').map((id) => id + '\n')
    );
    await assert.rejects(captureListDetected({ ids: 'npm' }), /Unknown id namespace: "npm"/);
  });

  // The installer pipes this command, which selects JSON: the piped shape is
  // the one the real consumer sees, so it is pinned per namespace.
  it('setup --list-detected in json mode prints one JSON array of ids', async () => {
    for (const namespace of ['polylane', 'skills-sh'] as const) {
      const out = (await captureListDetected({ ids: namespace }, 'json')).join('');
      assert.deepEqual(JSON.parse(out), detectedAgentIds(homedir(), namespace));
    }
  });

  it('hasAgentFootprint follows symlinks: a linked skills dir is skipped, a linked file counts', () => {
    // stow/chezmoi-style dotfiles: the agent dir holds a symlink to a skills
    // tree kept elsewhere. Dirents report the link as neither file nor dir.
    mkdirSync(join(tempDir, 'store', 'skills', 'x'), { recursive: true });
    writeFileSync(join(tempDir, 'store', 'skills', 'x', 'SKILL.md'), '#', 'utf-8');
    mkdirSync(join(tempDir, 'linked'));
    symlinkSync(join(tempDir, 'store', 'skills'), join(tempDir, 'linked', 'skills'));
    assert.equal(hasAgentFootprint(join(tempDir, 'linked')), false);

    writeFileSync(join(tempDir, 'store', 'settings.json'), '{}', 'utf-8');
    symlinkSync(join(tempDir, 'store', 'settings.json'), join(tempDir, 'linked', 'settings.json'));
    assert.equal(hasAgentFootprint(join(tempDir, 'linked')), true);

    mkdirSync(join(tempDir, 'dangling'));
    symlinkSync(join(tempDir, 'nowhere'), join(tempDir, 'dangling', 'config'));
    assert.equal(hasAgentFootprint(join(tempDir, 'dangling')), true);
  });

  it('detects cline from the VS Code extension storage alone', () => {
    mkdirSync(join(vscodeUserDirectory(tempDir), 'globalStorage', 'saoudrizwan.claude-dev'), { recursive: true });
    assert.equal(agent('cline').detect(tempDir), true);
  });

  it('detects claude from ~/.claude.json alone', () => {
    writeFileSync(join(tempDir, '.claude.json'), '{}', 'utf-8');
    assert.equal(agent('claude').detect(tempDir), true);
  });

  it('configures claude with a skill and an MCP entry', () => {
    const outcomes = agent('claude').user(tempDir, false);
    assert.equal(readFileSync(join(tempDir, '.claude', 'skills', 'polylane-cli', 'SKILL.md'), 'utf-8'), SKILL_MD);
    const parsed = JSON.parse(readFileSync(join(tempDir, '.claude.json'), 'utf-8')) as {
      mcpServers: Record<string, unknown>;
    };
    assert.deepEqual(parsed.mcpServers[MCP_SERVER_NAME], { type: 'http', url: MCP_SERVER_URL });
    assert.equal(outcomes.every((o) => o.action === 'created'), true);
  });

  it('configures cursor with a skill and an MCP entry', () => {
    agent('cursor').user(tempDir, false);
    assert.equal(readFileSync(join(tempDir, '.cursor', 'skills', 'polylane-cli', 'SKILL.md'), 'utf-8'), SKILL_MD);
    const parsed = JSON.parse(readFileSync(join(tempDir, '.cursor', 'mcp.json'), 'utf-8')) as {
      mcpServers: Record<string, unknown>;
    };
    assert.deepEqual(parsed.mcpServers[MCP_SERVER_NAME], { type: 'http', url: MCP_SERVER_URL });
  });

  it('configures opencode with a skill and a remote MCP entry', () => {
    agent('opencode').user(tempDir, false);
    assert.equal(
      readFileSync(join(tempDir, '.config', 'opencode', 'skills', 'polylane-cli', 'SKILL.md'), 'utf-8'),
      SKILL_MD
    );
    const parsed = JSON.parse(readFileSync(join(tempDir, '.config', 'opencode', 'opencode.json'), 'utf-8')) as {
      mcp: Record<string, unknown>;
    };
    assert.deepEqual(parsed.mcp[MCP_SERVER_NAME], { type: 'remote', url: MCP_SERVER_URL });
  });

  it('edits an existing opencode.jsonc instead of creating a sibling opencode.json', () => {
    const dir = join(tempDir, '.config', 'opencode');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'opencode.jsonc'), '{\n  // keep\n  "theme": "dark",\n}\n', 'utf-8');
    const outcomes = agent('opencode').user(tempDir, false);
    assert.equal(outcomes[1]?.path, join(dir, 'opencode.jsonc'));
    assert.equal(outcomes[1]?.action, 'updated');
    assert.equal(existsSync(join(dir, 'opencode.json')), false);
    assert.ok(readFileSync(join(dir, 'opencode.jsonc'), 'utf-8').includes('// keep'));
  });

  it('edits a project-level opencode.jsonc instead of creating a sibling opencode.json', () => {
    writeFileSync(join(tempDir, 'opencode.jsonc'), '{}\n', 'utf-8');
    const outcomes = agent('opencode').project!(tempDir, false);
    assert.equal(outcomes[1]?.path, join(tempDir, 'opencode.jsonc'));
    assert.equal(outcomes[1]?.action, 'updated');
    assert.equal(existsSync(join(tempDir, 'opencode.json')), false);
  });

  it('configures codex with a skill and a config.toml section', () => {
    agent('codex').user(tempDir, false);
    assert.equal(readFileSync(join(tempDir, '.codex', 'skills', 'polylane-cli', 'SKILL.md'), 'utf-8'), SKILL_MD);
    const toml = readFileSync(join(tempDir, '.codex', 'config.toml'), 'utf-8');
    assert.ok(toml.includes(`[mcp_servers.${MCP_SERVER_NAME}]`));
    assert.ok(toml.includes(`url = "${MCP_SERVER_URL}"`));
  });

  it('configures pi with a skill and a url MCP entry', () => {
    agent('pi').user(tempDir, false);
    assert.equal(readFileSync(join(tempDir, '.pi', 'agent', 'skills', 'polylane-cli', 'SKILL.md'), 'utf-8'), SKILL_MD);
    const parsed = JSON.parse(readFileSync(join(tempDir, '.pi', 'agent', 'mcp.json'), 'utf-8')) as {
      mcpServers: Record<string, unknown>;
    };
    assert.deepEqual(parsed.mcpServers[MCP_SERVER_NAME], { url: MCP_SERVER_URL });
  });

  it('configures warp with a skill and a url MCP entry', () => {
    agent('warp').user(tempDir, false);
    assert.equal(readFileSync(join(tempDir, '.warp', 'skills', 'polylane-cli', 'SKILL.md'), 'utf-8'), SKILL_MD);
    const parsed = JSON.parse(readFileSync(join(tempDir, '.warp', '.mcp.json'), 'utf-8')) as {
      mcpServers: Record<string, unknown>;
    };
    assert.deepEqual(parsed.mcpServers[MCP_SERVER_NAME], { url: MCP_SERVER_URL });
  });

  it('configures cline in every surface that exists', () => {
    mkdirSync(join(tempDir, '.cline'), { recursive: true });
    mkdirSync(join(vscodeUserDirectory(tempDir), 'globalStorage', 'saoudrizwan.claude-dev'), { recursive: true });
    const outcomes = agent('cline').user(tempDir, false);
    assert.equal(outcomes.length, 2);
    for (const file of [
      join(vscodeUserDirectory(tempDir), 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'),
      join(tempDir, '.cline', 'data', 'settings', 'cline_mcp_settings.json'),
    ]) {
      const parsed = JSON.parse(readFileSync(file, 'utf-8')) as { mcpServers: Record<string, unknown> };
      assert.deepEqual(parsed.mcpServers[MCP_SERVER_NAME], { type: 'streamableHttp', url: MCP_SERVER_URL });
    }
  });

  it('falls back to the cline CLI location when neither surface exists', () => {
    const outcomes = agent('cline').user(tempDir, false);
    assert.equal(outcomes.length, 1);
    assert.ok(existsSync(join(tempDir, '.cline', 'data', 'settings', 'cline_mcp_settings.json')));
  });

  it('configures roo with a streamable-http MCP entry', () => {
    agent('roo').user(tempDir, false);
    const parsed = JSON.parse(
      readFileSync(
        join(vscodeUserDirectory(tempDir), 'globalStorage', 'rooveterinaryinc.roo-cline', 'settings', 'mcp_settings.json'),
        'utf-8'
      )
    ) as { mcpServers: Record<string, unknown> };
    assert.deepEqual(parsed.mcpServers[MCP_SERVER_NAME], { type: 'streamable-http', url: MCP_SERVER_URL });
  });

  it('configures goose with a streamable_http extension in config.yaml', () => {
    agent('goose').user(tempDir, false);
    const yaml = readFileSync(join(tempDir, '.config', 'goose', 'config.yaml'), 'utf-8');
    assert.ok(yaml.includes(`extensions:\n  ${MCP_SERVER_NAME}:`));
    assert.ok(yaml.includes('type: streamable_http'));
    assert.ok(yaml.includes(`uri: ${MCP_SERVER_URL}`));
  });

  it('configures gemini with an httpUrl MCP entry', () => {
    agent('gemini').user(tempDir, false);
    const parsed = JSON.parse(readFileSync(join(tempDir, '.gemini', 'settings.json'), 'utf-8')) as {
      mcpServers: Record<string, unknown>;
    };
    assert.deepEqual(parsed.mcpServers[MCP_SERVER_NAME], { httpUrl: MCP_SERVER_URL });
  });

  it('configures windsurf with a serverUrl MCP entry only', () => {
    const outcomes = agent('windsurf').user(tempDir, false);
    assert.equal(outcomes.length, 1);
    const parsed = JSON.parse(
      readFileSync(join(tempDir, '.codeium', 'windsurf', 'mcp_config.json'), 'utf-8')
    ) as { mcpServers: Record<string, unknown> };
    assert.deepEqual(parsed.mcpServers[MCP_SERVER_NAME], { serverUrl: MCP_SERVER_URL });
  });

  it('configures zed with an mcp-remote context server', () => {
    agent('zed').user(tempDir, false);
    const parsed = JSON.parse(readFileSync(join(tempDir, '.config', 'zed', 'settings.json'), 'utf-8')) as {
      context_servers: Record<string, unknown>;
    };
    assert.deepEqual(parsed.context_servers[MCP_SERVER_NAME], {
      source: 'custom',
      command: 'npx',
      args: ['mcp-remote', MCP_SERVER_URL],
      env: {},
    });
  });

  it('is idempotent for every agent', () => {
    for (const definition of AGENTS.filter((a) => a.id !== 'vscode')) {
      definition.user(tempDir, false);
      const second = definition.user(tempDir, false);
      assert.equal(
        second.every((o) => o.action === 'unchanged'),
        true,
        `${definition.id} second run is a no-op`
      );
    }
  });

  it('writes project-scope config for claude', () => {
    const project = agent('claude').project;
    assert.ok(project);
    project(tempDir, false);
    assert.ok(existsSync(join(tempDir, '.claude', 'skills', 'polylane-cli', 'SKILL.md')));
    const parsed = JSON.parse(readFileSync(join(tempDir, '.mcp.json'), 'utf-8')) as {
      mcpServers: Record<string, unknown>;
    };
    assert.deepEqual(parsed.mcpServers[MCP_SERVER_NAME], { type: 'http', url: MCP_SERVER_URL });
  });

  it('writes project-scope config for pi and warp', () => {
    for (const [id, mcpPath] of [
      ['pi', join('.pi', 'mcp.json')],
      ['warp', join('.warp', '.mcp.json')],
    ] as const) {
      const project = agent(id).project;
      assert.ok(project);
      project(tempDir, false);
      assert.ok(existsSync(join(tempDir, `.${id}`, 'skills', 'polylane-cli', 'SKILL.md')));
      const parsed = JSON.parse(readFileSync(join(tempDir, mcpPath), 'utf-8')) as {
        mcpServers: Record<string, unknown>;
      };
      assert.deepEqual(parsed.mcpServers[MCP_SERVER_NAME], { url: MCP_SERVER_URL });
    }
  });

  it('reports codex project MCP as user-level only', () => {
    const project = agent('codex').project;
    assert.ok(project);
    const outcomes = project(tempDir, false);
    const mcp = outcomes.find((o) => o.label === 'MCP server');
    assert.ok(mcp);
    assert.equal(mcp.action, 'skipped');
  });
});

describe('decidePrimaryAgent', () => {
  const byId = (id: string) => {
    const found = AGENTS.find((a) => a.id === id);
    assert.ok(found);
    return found;
  };

  it('keeps an existing stored choice', () => {
    const decision = decidePrimaryAgent('claude', [byId('claude'), byId('cursor')], true);
    assert.deepEqual(decision, { kind: 'keep' });
  });

  it('does nothing when no agents are selected', () => {
    const decision = decidePrimaryAgent(undefined, [], true);
    assert.deepEqual(decision, { kind: 'keep' });
  });

  it('persists silently when exactly one agent is in play', () => {
    const decision = decidePrimaryAgent(undefined, [byId('codex')], false);
    assert.deepEqual(decision, { kind: 'persist', id: 'codex' });
  });

  it('prompts among the selected agents when several are detected interactively', () => {
    const candidates = [byId('claude'), byId('cursor'), byId('gemini')];
    const decision = decidePrimaryAgent(undefined, candidates, true);
    assert.equal(decision.kind, 'prompt');
    assert.ok(decision.kind === 'prompt');
    assert.deepEqual(decision.candidates.map((a) => a.id), ['claude', 'cursor', 'gemini']);
  });

  it('does not prompt outside an interactive terminal', () => {
    const decision = decidePrimaryAgent(undefined, [byId('claude'), byId('cursor')], false);
    assert.deepEqual(decision, { kind: 'keep' });
  });
});
