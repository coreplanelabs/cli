import type { Command } from '../../command';
import type { Config, RawConfig } from '../../config/schema';
import {
  validateDomain,
  validateApiKey,
  validateOutput,
  validateTimeout,
  validateWorkspaceId,
} from '../../config/schema';
import { writeConfigFile } from '../../config/loader';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import { requireArg } from '../helpers';

const VALID_KEYS = new Set(['domain', 'workspace_id', 'api_key', 'output', 'timeout', 'telemetry']);

export const configSetCommand: Command = {
  name: 'config set',
  description: 'Set a configuration value',
  operationId: 'config.set',
  options: [
    { flag: '--key <key>', description: 'Config key', type: 'string', required: true },
    { flag: '--value <value>', description: 'Config value', type: 'string', required: true },
  ],
  examples: [
    'nominal config set --key domain --value api.nominal.dev',
    'nominal config set --key workspace_id --value ws_xxxxx',
  ],
  async execute(config: Config, _flags, args): Promise<void> {
    const key = requireArg(args, 'key', '--key');
    const value = requireArg(args, 'value', '--value');

    if (!VALID_KEYS.has(key)) {
      throw new CLIError(
        `Unknown config key: ${key}`,
        ExitCode.USAGE,
        `Valid keys: ${[...VALID_KEYS].join(', ')}`
      );
    }

    const partial: Partial<RawConfig> = {};
    switch (key) {
      case 'domain':
        validateDomain(value);
        partial.domain = value;
        break;
      case 'workspace_id':
        validateWorkspaceId(value);
        partial.workspace_id = value;
        break;
      case 'api_key':
        validateApiKey(value);
        partial.api_key = value;
        break;
      case 'output': {
        validateOutput(value);
        partial.output = value;
        break;
      }
      case 'timeout': {
        const n = Number(value);
        validateTimeout(n);
        partial.timeout = n;
        break;
      }
      case 'telemetry': {
        const truthy = ['1', 'true', 'yes', 'on', 'enabled'];
        const falsy = ['0', 'false', 'no', 'off', 'disabled'];
        if (truthy.includes(value)) partial.telemetry = true;
        else if (falsy.includes(value)) partial.telemetry = false;
        else {
          throw new CLIError(
            `Invalid telemetry value: "${value}"`,
            ExitCode.USAGE,
            `Use one of: ${[...truthy, ...falsy].join(', ')}`
          );
        }
        break;
      }
    }

    if (config.dryRun) {
      process.stderr.write(`[dry-run] Would set ${key} = ${value}\n`);
      return;
    }

    writeConfigFile(partial);
    process.stderr.write(`Set ${key}\n`);
  },
};
