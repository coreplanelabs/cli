import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { maskToken } from '../../utils/token';
import { formatSingle } from '../../output/formatter';
import { CONFIG_FILE } from '../../config/paths';
import { fileExists } from '../../utils/fs';
import { readCredentials } from '../../auth/credentials';

export const configShowCommand: Command = {
  name: 'config show',
  description: 'Display current configuration',
  operationId: 'config.show',
  async execute(config: Config): Promise<void> {
    const cred = readCredentials();
    const authMethod = cred ? 'oauth' : config.apiKey ? 'api-key' : 'none';

    const result = {
      domain: config.domain,
      workspaceId: config.workspaceId ?? null,
      output: config.output,
      timeout: config.timeout,
      apiKey: config.apiKey ? maskToken(config.apiKey) : null,
      authMethod,
      configFile: CONFIG_FILE,
      configFileExists: fileExists(CONFIG_FILE),
    };
    formatSingle(config, result);
  },
};
