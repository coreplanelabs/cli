import type { Command } from '../command';
import type { Config } from '../config/schema';
import { registry, renderHelp } from '../registry';

export const helpCommand: Command = {
  name: 'help',
  description: 'Show help information',
  async execute(config: Config, _flags, args): Promise<void> {
    const positional = (args._ as string[] | undefined) ?? [];
    if (positional.length === 0) {
      process.stdout.write(renderHelp(null, config.noColor));
      return;
    }
    const resolved = registry.resolve(positional);
    if (!resolved) {
      process.stderr.write(`Unknown command: ${positional.join(' ')}\n`);
      process.stdout.write(renderHelp(null, config.noColor));
      return;
    }
    process.stdout.write(renderHelp(resolved.command, config.noColor));
  },
};
