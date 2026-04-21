import type { CLIError } from '../errors/base';

export function outputJson(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

export function outputJsonError(error: CLIError): void {
  process.stderr.write(JSON.stringify(error.toJSON(), null, 2) + '\n');
}
