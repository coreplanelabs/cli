import type { Command } from '../command';
import type { Config } from '../config/schema';
import { registry, renderHelp, unknownCommandMessage } from '../registry';
import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';

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
      throw new CLIError(
        unknownCommandMessage(positional, registry.suggestCommand(positional)),
        ExitCode.USAGE,
        'Run `polylane --help` to list commands'
      );
    }
    process.stdout.write(renderHelp(resolved.command, config.noColor));
  },
};
