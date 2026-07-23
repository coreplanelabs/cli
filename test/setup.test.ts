import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  installSkill,
  registerMcpServer,
  skillInstallPath,
  userAgentConfigPath,
  projectAgentConfigPath,
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

describe('skill and agent config paths', () => {
  it('places the skill under .claude/skills/polylane-cli', () => {
    assert.equal(
      skillInstallPath('/home/user'),
      join('/home/user', '.claude', 'skills', 'polylane-cli', 'SKILL.md')
    );
  });

  it('places the user agent config at .claude.json', () => {
    assert.equal(userAgentConfigPath('/home/user'), join('/home/user', '.claude.json'));
  });

  it('places the project agent config at .mcp.json', () => {
    assert.equal(projectAgentConfigPath('/repo'), join('/repo', '.mcp.json'));
  });
});

describe('installSkill', () => {
  it('creates the skill file with the bundled content', () => {
    const path = skillInstallPath(tempDir);
    const result = installSkill(path);
    assert.equal(result.action, 'created');
    assert.equal(result.path, path);
    assert.equal(readFileSync(path, 'utf-8'), SKILL_MD);
  });

  it('reports unchanged when the installed skill matches', () => {
    const path = skillInstallPath(tempDir);
    installSkill(path);
    const result = installSkill(path);
    assert.equal(result.action, 'unchanged');
    assert.equal(readFileSync(path, 'utf-8'), SKILL_MD);
  });

  it('overwrites a stale skill file', () => {
    const path = skillInstallPath(tempDir);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, 'old skill content', 'utf-8');
    const result = installSkill(path);
    assert.equal(result.action, 'updated');
    assert.equal(readFileSync(path, 'utf-8'), SKILL_MD);
  });
});

describe('registerMcpServer', () => {
  it('creates the config file with the polylane server entry', () => {
    const path = join(tempDir, '.claude.json');
    const result = registerMcpServer(path);
    assert.equal(result.action, 'registered');
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as {
      mcpServers: Record<string, { type: string; url: string }>;
    };
    assert.deepEqual(parsed.mcpServers[MCP_SERVER_NAME], {
      type: 'http',
      url: MCP_SERVER_URL,
    });
  });

  it('preserves unrelated keys and servers', () => {
    const path = join(tempDir, '.claude.json');
    writeFileSync(
      path,
      JSON.stringify({
        theme: 'dark',
        mcpServers: { other: { type: 'http', url: 'https://example.com/mcp' } },
      }),
      'utf-8'
    );
    const result = registerMcpServer(path);
    assert.equal(result.action, 'registered');
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as {
      theme: string;
      mcpServers: Record<string, { type: string; url: string }>;
    };
    assert.equal(parsed.theme, 'dark');
    assert.deepEqual(parsed.mcpServers.other, { type: 'http', url: 'https://example.com/mcp' });
    assert.deepEqual(parsed.mcpServers[MCP_SERVER_NAME], {
      type: 'http',
      url: MCP_SERVER_URL,
    });
  });

  it('leaves an existing polylane entry untouched', () => {
    const path = join(tempDir, '.claude.json');
    const existing = {
      mcpServers: {
        [MCP_SERVER_NAME]: {
          type: 'http',
          url: MCP_SERVER_URL,
          headers: { 'x-api-key': 'sk_custom' },
        },
      },
    };
    const original = JSON.stringify(existing);
    writeFileSync(path, original, 'utf-8');
    const result = registerMcpServer(path);
    assert.equal(result.action, 'unchanged');
    assert.equal(readFileSync(path, 'utf-8'), original);
  });

  it('skips and leaves the file alone when it is not valid JSON', () => {
    const path = join(tempDir, '.claude.json');
    writeFileSync(path, '{ not json', 'utf-8');
    const result = registerMcpServer(path);
    assert.equal(result.action, 'skipped');
    assert.equal(readFileSync(path, 'utf-8'), '{ not json');
  });

  it('skips when the file holds a JSON array instead of an object', () => {
    const path = join(tempDir, '.claude.json');
    writeFileSync(path, '[]', 'utf-8');
    const result = registerMcpServer(path);
    assert.equal(result.action, 'skipped');
    assert.equal(readFileSync(path, 'utf-8'), '[]');
  });

  it('creates parent directories when needed', () => {
    const path = join(tempDir, 'nested', '.mcp.json');
    const result = registerMcpServer(path);
    assert.equal(result.action, 'registered');
    assert.ok(existsSync(path));
  });
});
