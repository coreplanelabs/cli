import { readFileSync, rmSync } from 'node:fs';
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
  // build.ts excludes POLYLANE_ONBOARDING_RUN from its esbuild `define` sweep
  // (see DEFINE_EXCLUDE there), so this env read is never frozen into the bundle
  // and always resolves at runtime. That exclusion is the only guarantee — the
  // bracket access is not a fallback, since esbuild bakes indexed reads
  // identically to dotted ones when the key is in the define map.
  return sanitize(process.env['POLYLANE_ONBOARDING_RUN']) ?? sanitize(readOnboardingRunFile());
}

// The onboarding run funnel join is one-shot: once an auth flow has carried the
// run id to the server (which binds it to the account), the ~/.polylane/onboarding-run
// file is spent and must not stamp every future signup/login on this machine —
// including re-auths and other accounts on a shared machine. Delete it after a
// carrying flow completes. Missing file is fine; never let cleanup fail an auth
// flow. The env var is left untouched — it is explicit per-invocation.
export function consumeOnboardingRunFile(): void {
  try {
    rmSync(ONBOARDING_RUN_FILE, { force: true });
  } catch {
    // Best effort — a stale run file is harmless next to a completed auth.
  }
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
