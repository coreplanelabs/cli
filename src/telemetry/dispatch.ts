import type { Config } from '../config/schema';
import type { CliTelemetryEvent } from './event';

const DEFAULT_TELEMETRY_TIMEOUT_MS = 2000;

function getEndpoint(config: Config): string {
  const override = process.env.NOMINAL_TELEMETRY_ENDPOINT;
  if (override) return override;
  return `https://${config.domain}/v1/telemetry/cli`;
}

// Fires the event. Best-effort: silently swallows network / timeout / server
// errors so telemetry can never break an otherwise-successful command.
// `--verbose` surfaces the outcome to stderr for debugging.
export async function dispatch(config: Config, event: CliTelemetryEvent): Promise<void> {
  if (!config.telemetry) return;
  if (config.dryRun) return;

  const url = getEndpoint(config);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TELEMETRY_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': `nominal-cli/${event.cli.version}`,
        'x-nominal-client': 'cli',
        'x-nominal-client-version': event.cli.version,
      },
      body: JSON.stringify(event),
      signal: controller.signal,
    });
    if (config.verbose) {
      process.stderr.write(`[telemetry] ${res.status} ${url}\n`);
    }
  } catch (err) {
    if (config.verbose) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[telemetry] dropped: ${msg}\n`);
    }
  } finally {
    clearTimeout(timeout);
  }
}
