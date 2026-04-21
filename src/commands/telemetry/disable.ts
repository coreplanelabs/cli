import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { writeConfigFile } from '../../config/loader';

export const telemetryDisableCommand: Command = {
  name: 'telemetry disable',
  description: 'Disable anonymous usage telemetry',
  async execute(_config: Config): Promise<void> {
    writeConfigFile({ telemetry: false });
    process.stderr.write('Telemetry disabled.\n');
  },
};
