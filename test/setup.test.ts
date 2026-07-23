import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  AGENTS,
  writeSkillFile,
  upsertJsonEntry,
  upsertTomlSection,
  MCP_SERVER_NAME,
  MCP_SERVER_URL,
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

describe('agent definitions', () => {
  it('covers the supported agent list', () => {
    assert.deepEqual(
      AGENTS.map((a) => a.id),
      ['claude', 'cursor', 'opencode', 'codex', 'windsurf', 'zed', 'vscode']
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

  it('configures codex with a skill and a config.toml section', () => {
    agent('codex').user(tempDir, false);
    assert.equal(readFileSync(join(tempDir, '.codex', 'skills', 'polylane-cli', 'SKILL.md'), 'utf-8'), SKILL_MD);
    const toml = readFileSync(join(tempDir, '.codex', 'config.toml'), 'utf-8');
    assert.ok(toml.includes(`[mcp_servers.${MCP_SERVER_NAME}]`));
    assert.ok(toml.includes(`url = "${MCP_SERVER_URL}"`));
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

  it('reports codex project MCP as user-level only', () => {
    const project = agent('codex').project;
    assert.ok(project);
    const outcomes = project(tempDir, false);
    const mcp = outcomes.find((o) => o.label === 'MCP server');
    assert.ok(mcp);
    assert.equal(mcp.action, 'skipped');
  });
});
