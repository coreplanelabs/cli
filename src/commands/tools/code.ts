import { readFileSync, readSync } from 'node:fs';
import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { requestJson } from '../../client/http';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, getPositional, getArgString, getArgBoolean } from '../helpers';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';

interface RunEnvelope {
  success: boolean;
  durationMs: number;
  result?: unknown;
  error?: { message?: string } | string;
}

function readStdin(): string {
  const chunks: Buffer[] = [];
  const buf = Buffer.alloc(65536);
  while (true) {
    let bytesRead = 0;
    try {
      bytesRead = readSync(0, buf, 0, buf.length, null);
    } catch {
      break;
    }
    if (bytesRead === 0) break;
    chunks.push(Buffer.from(buf.subarray(0, bytesRead)));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

export const toolsCodeCommand: Command = {
  name: 'tools code',
  description: 'Chain several agent tools in one call by running TypeScript against the tools namespace',
  operationId: 'agent_tools.run_code',
  positional: [{ name: 'code', description: 'Async arrow calling tools.<name>(args); omit to use --file or stdin', variadic: true }],
  options: [
    { flag: '--file <path>', description: 'Read the code from a file ("-" for stdin)', type: 'string' },
    { flag: '--write', description: 'Allow write tools (needs a key/token with agent_tools:write)', type: 'boolean' },
  ],
  examples: [
    'polylane tools code \'async () => { return await tools.findNodes({ query: "api" }); }\'',
    'polylane tools code --file query.ts',
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);

    const file = getArgString(args, 'file');
    const positional = getPositional(args, 0);
    let code: string;
    if (file) {
      code = file === '-' ? readStdin() : readFileSync(file, 'utf-8');
    } else if (positional) {
      code = positional;
    } else {
      code = readStdin();
    }

    if (!code.trim()) {
      throw new CLIError('No code provided', ExitCode.USAGE, 'Pass code as an argument, --file <path>, or pipe it via stdin');
    }

    const allowWrites = getArgBoolean(args, 'write') === true;

    const envelope = await requestJson<RunEnvelope>(config, {
      url: '/v1/agent_tools/run_code',
      method: 'POST',
      body: { workspaceId, code },
      headers: allowWrites ? { 'x-polylane-allow-writes': 'true' } : undefined,
    });

    if (!envelope.success) {
      const message = typeof envelope.error === 'string' ? envelope.error : (envelope.error?.message ?? 'Code execution failed');
      throw new CLIError(message, ExitCode.GENERAL);
    }

    formatOutput(config, envelope.result);
  },
};
