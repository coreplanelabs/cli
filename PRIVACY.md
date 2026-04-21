# Telemetry & Privacy

The nominal CLI sends anonymous usage telemetry by default. This document is the authoritative source of truth for what we collect, what we don't, and how to opt out. The `nominal telemetry status` command prints the same information live.

## Quick links

- **Disable:** `nominal telemetry disable` (persists to `~/.nominal/config.json`)
- **Inspect:** `nominal telemetry status`
- **Re-enable:** `nominal telemetry enable`

## What we collect

One event per command invocation, fired after the command finishes (success or failure):

### Identity

| Field | Example | Purpose |
|---|---|---|
| `installId` | `"f2f3b5a4-..."` | Anonymous per-install UUID, generated once on first run |
| `sessionId` | `"31bbf6df-..."` | Per-process UUID, correlates events within one invocation |
| `workspaceId` | `"ws_xxx..."` | Tenant attribution (not user) |
| `authMethod` | `"oauth"` \| `"api-key"` \| `null` | Credential *class* — never the token itself |

### CLI + install

| Field | Example | Purpose |
|---|---|---|
| `cli.version` | `"0.1.0"` | CLI release in use |
| `cli.installSource` | `"brew"` | npm / brew / curl / winget / aur / bun / dev / unknown |

### Runtime

| Field | Example | Purpose |
|---|---|---|
| `runtime.node` | `"22.14.0"` | Node version |
| `runtime.os` | `"darwin"` | Platform |
| `runtime.osRelease` | `"23.5.0"` | Kernel / OS release version |
| `runtime.arch` | `"arm64"` | CPU architecture |
| `runtime.ci` / `runtime.ciName` | `true` / `"GitHub Actions"` | CI detection + provider |
| `runtime.tty` / `runtime.stderrTty` | `true` / `true` | Interactive vs piped |
| `runtime.shell` | `"zsh"` | Shell basename |
| `runtime.terminal` | `"iTerm.app"` | TERM_PROGRAM |
| `runtime.language` | `"en"` | Two-letter from `$LANG` (never the full locale) |
| `runtime.timezone` | `"America/New_York"` | IANA timezone |
| `runtime.cpuCount` | `10` | Logical CPU count |
| `runtime.cpuModel` | `"Apple M1 Pro"` | First CPU model string |
| `runtime.cpuSpeedMhz` | `3228` | First CPU clock speed |
| `runtime.totalMemoryMb` | `32768` | Total system memory (MB) |
| `runtime.memoryRssBytes` | `52428800` | Process RSS at event time |

### Invocation

| Field | Example | Purpose |
|---|---|---|
| `command` | `"case investigate"` | Which verb was used |
| `flags` | `["output", "quiet", "stream"]` | **Flag names only — never values** |
| `positionalArgCount` | `2` | Number of positional args (never the values) |
| `outputFormat` | `"json"` | Resolved text/json |
| `modes` | `{ quiet: true, verbose: false, ... }` | Mode flags state |
| `durationMs` | `1234` | Total command duration |
| `bootMs` | `42` | Process startup cost |
| `http.requestCount` / `http.totalMs` | `3` / `820` | API calls made + total HTTP time |

### Outcome

| Field | Example | Purpose |
|---|---|---|
| `exitCode` | `0` | Success / usage / auth / etc. |
| `error.code` / `error.category` | `3` / `"AUTH"` | Category only, on failures |
| `error.httpStatus` | `401` | Parsed from API error message when present (no message body shipped) |

### Sequence

| Field | Example | Purpose |
|---|---|---|
| `sequence.runCount` | `42` | Total invocations on this install (incl. this one) |
| `sequence.daysSinceInstall` | `7` | Cohort retention |
| `sequence.previousCommand` | `"workspace use"` | Funnel analysis |

## What we never collect

- Flag values, positional argument values, prompts
- Credentials, tokens, passwords, OAuth scopes
- User IDs, emails, names
- File paths, stdin contents, command output
- Full error messages or stack traces (only the category and HTTP status)

## Where events go

`POST https://<api-domain>/v1/telemetry/cli`. Override with `NOMINAL_TELEMETRY_ENDPOINT=<url>`.

Requests are fire-and-forget with a **2-second timeout** and silently fail on network / server errors. Telemetry cannot break a command.

## How to opt out

Any of these switches telemetry off:

| Method | Scope |
|---|---|
| `nominal telemetry disable` | Persistent — writes `telemetry: false` to `~/.nominal/config.json` |
| `nominal config set --key telemetry --value false` | Same (alt command) |
| `NOMINAL_TELEMETRY=0` (or `false`, `no`, `off`) | Per-invocation / per-shell |
| `DO_NOT_TRACK=1` | Universal — respects the [DO_NOT_TRACK](https://consoledonottrack.com/) standard |

Precedence: `DO_NOT_TRACK` > `NOMINAL_TELEMETRY` env var > config file > default (on).

When disabled, no events are sent. The install ID stays on disk (so re-enabling works), but nothing leaves your machine.

## First-run notice

The first time you run a command with telemetry enabled, the CLI writes a one-line notice to stderr pointing you at this document. It records that the notice has been shown in `~/.nominal/telemetry.json` and does not repeat.

## State files

- `~/.nominal/telemetry.json` — install ID + first-run notice flag
- `~/.nominal/config.json` — `telemetry: false` (if opted out)

Both are mode `0600`.
