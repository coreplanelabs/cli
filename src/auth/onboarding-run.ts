import { readFileSync } from 'node:fs';
import { ONBOARDING_RUN_FILE } from '../config/paths';

// Pre-auth onboarding run identifier minted by the website installer, mirroring
// the ~/.polylane/ref referral-slug pattern. The installer exports it as
// POLYLANE_ONBOARDING_RUN into the auth command it drives and writes it to
// ~/.polylane/onboarding-run; the env var wins so a fresh installer run beats a
// stale file. Strictly a UUID — the server discards anything else, so invalid
// values are dropped here silently. Lowercased so the server-side bind event
// joins the pre-auth telemetry rows byte-for-byte.
const ONBOARDING_RUN_ID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const ONBOARDING_RUN_QUERY_PARAM = 'run';

function sanitize(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed || !ONBOARDING_RUN_ID_PATTERN.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

function readOnboardingRunFile(): string | null {
  try {
    return readFileSync(ONBOARDING_RUN_FILE, 'utf-8');
  } catch {
    return null;
  }
}

export function resolveOnboardingRunId(): string | null {
  // Indexed access on purpose: the build bakes dotted `process.env.POLYLANE_*`
  // reads into the bundle via esbuild define; this must stay a runtime read.
  return sanitize(process.env['POLYLANE_ONBOARDING_RUN']) ?? sanitize(readOnboardingRunFile());
}

export function withOnboardingRun(uri: string, runId: string | null): string {
  if (!runId) return uri;
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return uri;
  }
  url.searchParams.set(ONBOARDING_RUN_QUERY_PARAM, runId);
  return url.toString();
}
