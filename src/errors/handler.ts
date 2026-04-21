import { CLIError, isCLIError } from './base';
import { ExitCode } from './codes';
import { outputJsonError } from '../output/json';
import type { Config } from '../config/schema';

function hasCode(err: unknown, code: string): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === code;
}

function wrapUnknown(err: unknown): CLIError {
  if (isCLIError(err)) return err;

  if (err instanceof Error) {
    const name = err.name;
    const msg = err.message;

    if (name === 'AbortError' || msg.includes('aborted') || msg.includes('timeout')) {
      return new CLIError('Request timed out', ExitCode.TIMEOUT, 'Try increasing --timeout');
    }

    if (hasCode(err, 'ECONNREFUSED')) {
      return new CLIError('Connection refused', ExitCode.NETWORK, 'Check the API domain');
    }
    if (hasCode(err, 'ENOTFOUND')) {
      return new CLIError(
        `DNS lookup failed: ${msg}`,
        ExitCode.NETWORK,
        'Check your network connection and the --domain flag'
      );
    }
    if (hasCode(err, 'ETIMEDOUT')) {
      return new CLIError('Connection timed out', ExitCode.TIMEOUT);
    }
    if (hasCode(err, 'ENOENT')) {
      return new CLIError(`File not found: ${msg}`, ExitCode.GENERAL);
    }
    if (hasCode(err, 'EACCES')) {
      return new CLIError(`Permission denied: ${msg}`, ExitCode.GENERAL);
    }
    if (hasCode(err, 'ENOSPC')) {
      return new CLIError('No space left on device', ExitCode.GENERAL);
    }

    if (err instanceof TypeError && msg.toLowerCase().includes('fetch')) {
      return new CLIError(`Network error: ${msg}`, ExitCode.NETWORK);
    }

    return new CLIError(msg, ExitCode.GENERAL);
  }

  return new CLIError(String(err), ExitCode.GENERAL);
}

function formatTextError(err: CLIError, verbose: boolean, noColor: boolean): void {
  const red = (s: string): string => (noColor ? s : `\x1B[31m${s}\x1B[0m`);
  const dim = (s: string): string => (noColor ? s : `\x1B[2m${s}\x1B[0m`);

  process.stderr.write(`${red('Error:')} ${err.message}\n`);
  if (err.hint) {
    process.stderr.write(`${dim('Hint:')} ${err.hint}\n`);
  }
  if (verbose && err.stack) {
    process.stderr.write(`\n${dim(err.stack)}\n`);
  }
}

export function handleError(err: unknown, config: Config | null): never {
  const cliErr = wrapUnknown(err);
  const verbose = config?.verbose ?? false;
  const noColor = config?.noColor ?? false;
  const jsonOutput = config?.output === 'json';

  if (jsonOutput) {
    outputJsonError(cliErr);
  } else {
    formatTextError(cliErr, verbose, noColor);
  }

  process.exit(cliErr.exitCode);
}
