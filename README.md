# nominal

<p><strong>Agent-focused CLI for the <a href="https://nominal.dev">Nominal</a> platform.</strong><br>
Investigate incidents, explore cloud infrastructure, search code and wikis, run automations, and drive threads — from any agent or terminal.</p>

<p>
  <a href="https://www.npmjs.com/package/@coreplane/nominal"><img src="https://img.shields.io/npm/v/@coreplane/nominal.svg" alt="npm version"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg" alt="Node.js >= 18"></a>
</p>

## What this is

`nominal` is designed to be driven by AI agents. Top-level commands map to the tasks an agent actually performs:

- **Investigate** cases with hypothesis generation
- **Explore** cloud infrastructure — logs, metrics, dependency graphs
- **Search** code and wikis
- **Remember** findings
- **Converse** with the Nominal agent (streaming supported)
- **Automate** workflows from a catalog
- **Connect** integrations and cloud accounts

The full API surface is available behind `nominal api call <op>` as an escape hatch.

## Install

Pick whichever channel fits your system. All install the same Node-based bundle and require Node 18+ (Homebrew / AUR / winget pull Node in as a dependency; the curl + PowerShell installers check for it).

```bash
# macOS / Linux — curl
curl -fsSL https://nominal.dev/install.sh | bash

# Windows — PowerShell
irm https://nominal.dev/install.ps1 | iex

# Homebrew (tap: coreplanelabs/nominal)
brew install coreplanelabs/nominal

# winget (Windows)
winget install Coreplane.Nominal

# Arch Linux (AUR)
paru -S nominal   # or: yay -S nominal

# npm
npm install -g @coreplane/nominal

# Bun
bun add -g @coreplane/nominal
```

> Requires [Node.js](https://nodejs.org) 18+ at runtime.

Version-pin the curl / PowerShell installers with:

```bash
NOMINAL_VERSION=v0.1.0 curl -fsSL https://nominal.dev/install.sh | bash
$env:NOMINAL_VERSION='v0.1.0'; irm https://nominal.dev/install.ps1 | iex
```

## Quick start

```bash
# 1. Authenticate (pick one)
nominal auth login                            # OAuth browser (humans at a terminal)
nominal auth login --api-key sk_xxxxx         # API key (CI / agents)
nominal auth signup --email agent@example.com # bootstrap a fresh account
                                              # (returns a session token; create an
                                              # API key after step 2 for long-lived use)

# 2. Workspace
nominal workspace create --name "My Workspace"   # creates + makes default
# or: nominal workspace use <workspace-id>

# 3. Connect your stack (discover what's available first)
nominal integration catalog
nominal integration connect --type <type>        # see `nominal integration connect --help`
nominal cloud connect --provider <provider>      # see `nominal cloud connect --help`

# 4. Work
nominal cases                                    # alias for `case list`
nominal case investigate <case-id> "<prompt>"
nominal service logs <service> --since 1h --grep error
nominal thread ask "<prompt>" --stream
nominal memory save "<finding>"
```

## Discovering commands

Run `nominal --help` for the resource list, `nominal <resource> --help` for its commands, and `nominal <resource> <command> --help` for flags and examples. Help is the authoritative source — it reflects the installed version, this document does not.

For the full API surface not yet exposed as first-class commands:

```bash
nominal api list                     # browse every operation
nominal api list --tag Cases         # filter by tag
nominal api describe <operation-id>  # show its shape
nominal api call <operation-id> [--body '{...}' | --body-file path]
```

## Agent-first defaults

| Behaviour | Default |
|---|---|
| **Output** | Text tables in TTY; JSON when stdout is piped |
| **List projections** | Narrow set of useful fields; `--full` dumps complete objects |
| **Single object reads** | Full object, with a `Console: …` / `Next: …` footer surfacing `_html_url` and `_links` |
| **Errors** | Every error ends with the exact command that fixes it (see [ERRORS.md](ERRORS.md)) |
| **Streaming** | `thread ask` / `thread continue` stream via WebSocket when `--stream` is passed |
| **Non-interactive** | `--non-interactive` fails fast on missing args instead of prompting |

## Agent flags

Combine in non-interactive (agent / CI) contexts:

```bash
nominal ... --non-interactive --quiet --output json
```

| Flag | Purpose |
|---|---|
| `--non-interactive` | Fail fast on missing args instead of prompting |
| `--quiet` | Suppress spinners / progress; stdout stays pure data |
| `--output json` | Force JSON regardless of TTY state |
| `--full` | Disable narrow projection on list commands |
| `--no-wait` | Return immediately (send-and-forget) |
| `--stream` | Stream assistant tokens |
| `--dry-run` | Show the request that would be sent without executing |
| `--verbose` | Log HTTP method / URL / response status |
| `--yes` | Skip destructive-action confirmations |

## Environment variables

| Variable | Purpose |
|---|---|
| `NOMINAL_API_DOMAIN` | API hostname (no protocol) |
| `NOMINAL_API_KEY` | API key |
| `NOMINAL_WORKSPACE_ID` | Default workspace |
| `NOMINAL_OUTPUT` | `text` or `json` (overrides TTY auto-detect) |
| `NOMINAL_TIMEOUT` | Request timeout (seconds) |
| `NOMINAL_VERBOSE` | Enable verbose HTTP logging |
| `NOMINAL_TELEMETRY` | `0` / `false` / `off` disables anonymous usage telemetry |
| `NOMINAL_TELEMETRY_ENDPOINT` | Override the telemetry endpoint (defaults to `<api>/v1/telemetry/cli`) |
| `DO_NOT_TRACK` | Universal `1` disables telemetry ([standard](https://consoledonottrack.com/)) |
| `NOMINAL_OAUTH_CLIENT_ID` / `NOMINAL_OAUTH_CLIENT_SECRET` | OAuth client override (normally baked at build) |
| `NOMINAL_CONSOLE_DOMAIN` | Consent-UI host override (defaults to the API host with `api.` → `console.`) |
| `NO_COLOR` | Disable ANSI colours |

## Configuration file

`~/.nominal/config.json` (mode `0600`):

```json
{
  "domain": "...",
  "workspace_id": "ws_xxxxx...",
  "api_key": "sk_xxxxx...",
  "output": "text",
  "timeout": 300
}
```

Precedence: **CLI flags > env vars > config file > defaults**.

Manage with `nominal config show` and `nominal config set --key <key> --value <value>`.

## Authentication

| Command | When |
|---|---|
| `nominal auth login --api-key sk_...` | Scripts / CI / machines |
| `nominal auth login` | Interactive OAuth (browser, PKCE) |
| `nominal auth login --no-browser` | OAuth device code (SSH / headless) |
| `nominal auth signup --email … --password …` | Bootstrap a fresh account from an agent (no browser, no human) |

OAuth credentials live at `~/.nominal/credentials.json` (mode `0600`) and auto-refresh before expiry. `nominal auth status` reports the active source.

For account lifecycle operations beyond signup/login (verify email, reset password, update profile, delete account, notification settings) — use the web console. They're available via `nominal api call <op>` if you really need them from the CLI, but they're not first-class commands.

## Telemetry

Anonymous usage telemetry is **on by default**. One event per command (name, flag *names*, exit code, duration, CLI/Node/OS versions, workspace ID, auth method class). Never argument values, credentials, or user identity.

```bash
nominal telemetry status         # see exactly what's collected and where it goes
nominal telemetry disable        # opt out (persisted)
NOMINAL_TELEMETRY=0 nominal ...  # per-invocation opt-out
DO_NOT_TRACK=1 nominal ...       # universal opt-out
```

Full details: [PRIVACY.md](PRIVACY.md).

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | General error |
| 2 | Usage error (bad flag, missing arg) |
| 3 | Authentication error |
| 4 | Rate limit or plan upgrade required |
| 5 | Timeout |
| 6 | Network error |
| 130 | Interrupted (Ctrl-C / SIGINT) |

See [ERRORS.md](ERRORS.md) for the per-scenario reference.

## Documentation

- **[skill/SKILL.md](skill/SKILL.md)** — agent-facing usage reference
- **[AGENTS.md](AGENTS.md)** — contributor guide for agents writing code in this repo
- **[ERRORS.md](ERRORS.md)** — error scenarios and messages

## Development

```bash
npm install
npm run codegen      # fetch spec from $NOMINAL_API_DOMAIN/v1/doc
npm run typecheck
npm run lint
npm run test
npm run build        # codegen + esbuild → dist/nominal.mjs
```

The HTTP client is generated at build time from the OpenAPI spec. Top-level commands hand-craft the agent UX on top of it.

### Dev environment (pointing at non-prod)

Put any `NOMINAL_*` override in a gitignored `.env.local` at the repo root. `npm run dev`, `npm run codegen`, and `npm run build` pick it up; `npm run build` additionally bakes every `NOMINAL_*` value into the bundle via esbuild `define`. `npm test` does **not** load `.env.local` — tests verify source defaults. A clean checkout produces a prod bundle and runtime env overrides still work.

## License

[MIT](LICENSE)
