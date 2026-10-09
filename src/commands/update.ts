import type { Command } from '../command';
import { updateCli } from '../update';

export const updateCommand: Command = {
  name: 'update',
  description: 'Update the active CLI install',
  async execute(config): Promise<void> {
    await updateCli(config);
  },
};
