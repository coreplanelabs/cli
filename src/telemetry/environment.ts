import { sep } from 'node:path';
import { release as osRelease, cpus as osCpus, totalmem } from 'node:os';

export type InstallSource = 'npm' | 'bun' | 'brew' | 'curl' | 'winget' | 'aur' | 'dev' | 'unknown';

// Best-effort detection of how the user got the binary, by inspecting the path
// the launcher came from. False positives go to "unknown" rather than a wrong
// label. Used purely for distribution-channel analytics.
export function detectInstallSource(): InstallSource {
  const candidates: string[] = [process.argv[1] ?? '', process.execPath ?? ''];
  const haystack = candidates.join('|').toLowerCase();
  if (!haystack) return 'unknown';

  // Local dev / `npm run dev` / `tsx src/main.ts`
  if (haystack.includes(`${sep}src${sep}main.ts`) || haystack.includes('/src/main.ts')) return 'dev';

  // Curl / PowerShell installers write to ~/.nominal/bin
  if (haystack.includes(`${sep}.nominal${sep}bin`) || haystack.includes('/.nominal/bin')) return 'curl';

  // Bun's global bin
  if (haystack.includes(`${sep}.bun${sep}`) || haystack.includes('/.bun/')) return 'bun';

  // Homebrew Cellar / opt
  if (haystack.includes(`${sep}cellar${sep}`) || haystack.includes(`${sep}homebrew${sep}`)) return 'brew';

  // winget portable / Microsoft.Winget
  if (haystack.includes(`${sep}winget${sep}`) || haystack.includes('microsoft\\winget')) return 'winget';

  // Arch (AUR is installed under /usr/lib/node_modules)
  if (haystack.includes(`${sep}usr${sep}lib${sep}node_modules${sep}nominal`)) return 'aur';

  // Generic npm-global location
  if (haystack.includes(`${sep}npm${sep}`) || haystack.includes(`${sep}node_modules${sep}`)) return 'npm';

  return 'unknown';
}

export interface EnvironmentInfo {
  shell: string | null;        // "zsh", "bash", "fish", "pwsh", null
  terminal: string | null;     // TERM_PROGRAM, e.g. "iTerm.app", "vscode", "Apple_Terminal", null
  language: string | null;     // 2-letter ISO from $LANG, never the full locale
  timezone: string | null;     // IANA tz, e.g. "America/New_York"
  memoryRssBytes: number;      // process RSS at event time
  // Hardware fingerprint — deliberately coarse (model + speed + count).
  // Useful for performance analytics but not granular enough to identify
  // a specific machine.
  osRelease: string;           // os.release(), e.g. "23.5.0"
  cpuCount: number;
  cpuModel: string | null;     // first CPU's model string, e.g. "Apple M1 Pro"
  cpuSpeedMhz: number | null;  // first CPU's clock speed
  totalMemoryMb: number;       // os.totalmem() in MB (rounded)
}

export function detectEnvironment(): EnvironmentInfo {
  const env = process.env;

  // Shell name only — strip directory parts so we don't ship anything
  // user-specific from custom shell locations.
  const shellPath = env.SHELL ?? env.ComSpec ?? null;
  const shell = shellPath ? shellPath.split(/[\\/]/).pop()!.replace(/\.exe$/i, '') : null;

  const terminal = env.TERM_PROGRAM ?? (env.WT_SESSION ? 'WindowsTerminal' : null);

  // Two-letter language code only — "en_US.UTF-8" → "en". Region + encoding
  // would narrow people to a few hundred per cohort, that's too granular.
  const langRaw = env.LANG ?? env.LC_ALL ?? env.LC_MESSAGES ?? null;
  const language = langRaw ? langRaw.split(/[._]/)[0] || null : null;

  let timezone: string | null = null;
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    // older runtimes / stripped icu builds
  }

  const memoryRssBytes = process.memoryUsage().rss;
  const cpus = osCpus() ?? [];
  const firstCpu = cpus[0];

  return {
    shell,
    terminal,
    language,
    timezone,
    memoryRssBytes,
    osRelease: osRelease(),
    cpuCount: cpus.length,
    cpuModel: firstCpu?.model ?? null,
    cpuSpeedMhz: firstCpu?.speed ?? null,
    totalMemoryMb: Math.trunc(totalmem() / (1024 * 1024)),
  };
}
