import type { Config } from '../config/schema';
import { hasShownFirstRunNotice, markFirstRunNoticeShown } from './state';

// The env var lets an installer that prints the telemetry disclosure itself
// (at a calm moment, not mid-sign-in) mark the first-run notice as shown
// without the CLI printing it again. The exact name is shared with the
// install script — keep them in sync.
export const TELEMETRY_NOTICE_ACK_ENV = 'POLYLANE_TELEMETRY_NOTICE_ACK';

export function maybeShowTelemetryNotice(config: Config, isTelemetryCommand: boolean): void {
  if (!config.telemetry) return;
  if (isTelemetryCommand) return;
  if (hasShownFirstRunNotice()) return;
  if (process.env[TELEMETRY_NOTICE_ACK_ENV] === '1') {
    markFirstRunNoticeShown();
    return;
  }
  if (config.quiet || config.output === 'json') return;
  process.stderr.write(
    'Anonymous usage telemetry is enabled. Run `polylane telemetry status` to see what\n' +
      'gets sent, or `polylane telemetry disable` to opt out.\n\n'
  );
  markFirstRunNoticeShown();
}
