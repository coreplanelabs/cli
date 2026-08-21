import { CLIError } from './base';
import { ExitCode } from './codes';

export interface ApiErrorPayload {
  message: string;
  detail?: string;
}

export class ApiError extends CLIError {
  readonly status: number;

  constructor(status: number, message: string, exitCode: ExitCode = ExitCode.GENERAL, hint?: string) {
    super(message, exitCode, hint);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

export function mapApiError(status: number, error: ApiErrorPayload | null): ApiError {
  const detail = error?.detail;
  const message = error?.message ?? `The request did not succeed (${status})`;

  switch (status) {
    case 400:
      return new ApiError(status, detail || 'Bad request', ExitCode.USAGE);
    case 401:
      return new ApiError(
        status,
        detail || 'Not signed in.',
        ExitCode.AUTH,
        'Run `polylane auth login`'
      );
    case 403:
      return new ApiError(
        status,
        detail || 'Permission denied',
        ExitCode.AUTH,
        'Check your API key scopes or workspace permissions'
      );
    case 404:
      return new ApiError(status, detail || 'Resource not found', ExitCode.GENERAL);
    case 409:
      return new ApiError(status, detail || 'Conflict', ExitCode.GENERAL);
    case 418:
      return new ApiError(
        status,
        detail || 'Feature not available',
        ExitCode.GENERAL,
        'This feature may be disabled on your plan'
      );
    case 422:
      return new ApiError(status, detail || 'Unprocessable content', ExitCode.USAGE);
    case 426:
      return new ApiError(
        status,
        detail || 'Plan upgrade required',
        ExitCode.QUOTA,
        'Upgrade your workspace plan to use this feature'
      );
    case 429:
      return new ApiError(
        status,
        detail || 'Rate limited',
        ExitCode.QUOTA,
        'Wait a moment and retry'
      );
    case 500:
    case 502:
    case 503:
    case 504:
      return new ApiError(
        status,
        detail || 'Server error',
        ExitCode.GENERAL,
        'Try again later'
      );
    default:
      return new ApiError(status, detail || message, ExitCode.GENERAL);
  }
}
