import { CLIError } from './base';
import { ExitCode } from './codes';

export interface ApiErrorPayload {
  message: string;
  detail?: string;
}

export function mapApiError(status: number, error: ApiErrorPayload | null): CLIError {
  const detail = error?.detail;
  const message = error?.message ?? `The request did not succeed (${status})`;

  switch (status) {
    case 400:
      return new CLIError(detail || 'Bad request', ExitCode.USAGE);
    case 401:
      return new CLIError(
        detail || 'Not signed in.',
        ExitCode.AUTH,
        'Run `polylane auth login`'
      );
    case 403:
      return new CLIError(
        detail || 'Permission denied',
        ExitCode.AUTH,
        'Check your API key scopes or workspace permissions'
      );
    case 404:
      return new CLIError(detail || 'Resource not found', ExitCode.GENERAL);
    case 409:
      return new CLIError(detail || 'Conflict', ExitCode.GENERAL);
    case 418:
      return new CLIError(
        detail || 'Feature not available',
        ExitCode.GENERAL,
        'This feature may be disabled on your plan'
      );
    case 426:
      return new CLIError(
        detail || 'Plan upgrade required',
        ExitCode.QUOTA,
        'Upgrade your workspace plan to use this feature'
      );
    case 429:
      return new CLIError(
        detail || 'Rate limited',
        ExitCode.QUOTA,
        'Wait a moment and retry'
      );
    case 500:
    case 502:
    case 503:
    case 504:
      return new CLIError(
        detail || 'Server error',
        ExitCode.GENERAL,
        'Try again later'
      );
    default:
      return new CLIError(detail || message, ExitCode.GENERAL);
  }
}
