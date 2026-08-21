import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseJsonc, type ParseError } from 'jsonc-parser';
import {
  AGENTS,
  writeSkillFile,
  upsertJsonEntry,
  upsertJsoncEntry,
  opencodeConfigFile,
  upsertTomlSection,
  upsertGooseExtension,
  vscodeUserDirectory,
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
    mkdirSync(join(tempDir, '.claude'), { recursive: true });
    assert.equal(agent('claude').detect(tempDir), true);

    assert.equal(agent('codex').detect(tempDir), false);
    mkdirSync(join(tempDir, '.codex'), { recursive: true });
    assert.equal(agent('codex').detect(tempDir), true);

    assert.equal(agent('windsurf').detect(tempDir), false);
    mkdirSync(join(tempDir, '.codeium', 'windsurf'), { recursive: true });
    assert.equal(agent('windsurf').detect(tempDir), true);

    assert.equal(agent('pi').detect(tempDir), false);
    mkdirSync(join(tempDir, '.pi'), { recursive: true });
    assert.equal(agent('pi').detect(tempDir), true);

    assert.equal(agent('warp').detect(tempDir), false);
    mkdirSync(join(tempDir, '.warp'), { recursive: true });
    assert.equal(agent('warp').detect(tempDir), true);

    assert.equal(agent('cline').detect(tempDir), false);
    mkdirSync(join(tempDir, '.cline'), { recursive: true });
    assert.equal(agent('cline').detect(tempDir), true);

    assert.equal(agent('roo').detect(tempDir), false);
    mkdirSync(join(vscodeUserDirectory(tempDir), 'globalStorage', 'rooveterinaryinc.roo-cline'), { recursive: true });
    assert.equal(agent('roo').detect(tempDir), true);

    assert.equal(agent('goose').detect(tempDir), false);
    mkdirSync(join(tempDir, '.config', 'goose'), { recursive: true });
    assert.equal(agent('goose').detect(tempDir), true);

    assert.equal(agent('gemini').detect(tempDir), false);
    mkdirSync(join(tempDir, '.gemini'), { recursive: true });
    assert.equal(agent('gemini').detect(tempDir), true);
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
