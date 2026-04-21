import { randomUUID } from 'node:crypto';
import { TELEMETRY_STATE_FILE, ensureConfigDir } from '../config/paths';
import { readJsonFile, writeJsonFile } from '../utils/fs';

interface TelemetryState {
  installId: string;
  firstRunNoticeShown?: boolean;
  // Sequence + cohort tracking (see PRIVACY.md). All anonymous.
  firstSeenAt?: string; // ISO date of the first invocation on this install
  lastSeenAt?: string;  // ISO date of the most recent invocation
  runCount?: number;    // total invocations on this install
  lastCommand?: string; // previous command name (for funnel analysis)
}

function writeState(state: TelemetryState): void {
  ensureConfigDir();
  writeJsonFile(TELEMETRY_STATE_FILE, state, 0o600);
}

function loadState(): TelemetryState | null {
  const raw = readJsonFile<TelemetryState>(TELEMETRY_STATE_FILE);
  if (!raw || typeof raw.installId !== 'string' || raw.installId.length === 0) return null;
  return raw;
}

// Stable, anonymous per-install ID. Generated once on first invocation and
// cached in ~/.nominal/telemetry.json. NOT tied to the user; users on the same
// machine see the same ID, and each fresh `~/.nominal` wipe produces a new one.
export function getInstallId(): string {
  const existing = loadState();
  if (existing) return existing.installId;
  const installId = randomUUID();
  writeState({ installId, firstSeenAt: new Date().toISOString() });
  return installId;
}

export function hasShownFirstRunNotice(): boolean {
  return loadState()?.firstRunNoticeShown === true;
}

export function markFirstRunNoticeShown(): void {
  const current = loadState() ?? { installId: randomUUID(), firstSeenAt: new Date().toISOString() };
  writeState({ ...current, firstRunNoticeShown: true });
}

export interface RunSequence {
  runCount: number;
  daysSinceInstall: number | null;
  previousCommand: string | null;
}

// Reads the previous-run state for the event, then advances it. Always called
// once per invocation, after `getInstallId` has ensured the file exists.
export function recordRun(currentCommand: string): RunSequence {
  const current = loadState() ?? { installId: randomUUID(), firstSeenAt: new Date().toISOString() };
  const previousCommand = current.lastCommand ?? null;
  const previousCount = current.runCount ?? 0;

  const firstSeen = current.firstSeenAt ? Date.parse(current.firstSeenAt) : NaN;
  const daysSinceInstall = Number.isFinite(firstSeen)
    ? Math.max(0, Math.floor((Date.now() - firstSeen) / (24 * 60 * 60 * 1000)))
    : null;

  writeState({
    ...current,
    firstSeenAt: current.firstSeenAt ?? new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    runCount: previousCount + 1,
    lastCommand: currentCommand,
  });

  return {
    runCount: previousCount + 1,
    daysSinceInstall,
    previousCommand,
  };
}
