import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { writeConfigFile } from '../../config/loader';

export const telemetryEnableCommand: Command = {
  name: 'telemetry enable',
  description: 'Enable anonymous usage telemetry',
  async execute(_config: Config): Promise<void> {
    writeConfigFile({ telemetry: true });
    process.stderr.write('Telemetry enabled.\n');
    if (process.env.DO_NOT_TRACK && process.env.DO_NOT_TRACK !== '0' && process.env.DO_NOT_TRACK !== 'false') {
      process.stderr.write(
        '  Note: DO_NOT_TRACK is set in your environment, which overrides the config. Unset it to actually send telemetry.\n'
      );
    }
  },
};
