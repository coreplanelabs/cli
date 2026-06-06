import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { PolylaneAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';

export const authWhoamiCommand: Command = {
  name: 'auth whoami',
  description: 'Show the currently authenticated user',
  operationId: 'auth.whoami',
  async execute(config: Config): Promise<void> {
    const api = new PolylaneAPI(config);
    const user = await api.authWhoami();
    formatOutput(config, user);
  },
};
