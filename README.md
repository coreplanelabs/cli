# polylane

<p><strong>Agent-focused CLI for the <a href="https://polylane.com">Polylane</a> platform.</strong><br>
Investigate production issues, explore cloud infrastructure, search code, run automations, and drive threads — from any agent or terminal.</p>

<p>Your coding agent writes the code. It can't see production. Polylane is the missing sense.</p>

<p>📚 <strong>Docs: <a href="https://docs.polylane.com">docs.polylane.com</a></strong> · <a href="https://docs.polylane.com/getting-started">Getting started</a> · <a href="https://docs.polylane.com/llms.txt">llms.txt</a> (agent index)</p>

<p>
  <a href="https://www.npmjs.com/package/@coreplane/polylane"><img src="https://img.shields.io/npm/v/@coreplane/polylane.svg" alt="npm version"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg" alt="Node.js >= 20"></a>
</p>

## What this is

`polylane` is designed to be driven by AI agents. Top-level commands map to the tasks an agent actually performs:

- **Triage** issues — detections and alerts across your cloud and observability stack
- **Drive** issue timelines — record notes and milestones as you respond
- **Explore** cloud infrastructure — logs, metrics, dependency graphs
- **Search** code
- **Run** the platform's agent tools directly (`tools search` / `tools run` / `tools code`)
- **Remember** findings
- **Converse** with the Polylane agent (streaming supported)
- **Automate** workflows from a catalog
- **Connect** integrations and cloud accounts

The full API surface is available behind `polylane api call <op>` as an escape hatch.

## Install

Pick whichever channel fits your system. All install the same Node-based bundle and require Node 20+ (Homebrew pulls Node in as a dependency; the curl + PowerShell installers check for it).

```bash
# macOS / Linux — curl
curl -fsSL https://polylane.com/install.sh | bash

# Windows — PowerShell
irm https://polylane.com/install.ps1 | iex

# Homebrew (tap: coreplanelabs/tap)
brew install coreplanelabs/tap/polylane

# npm
npm install -g @coreplane/polylane

# Bun
bun add -g @coreplane/polylane
```

> Requires [Node.js](https://nodejs.org) 20+ at runtime.

Version-pin the curl / PowerShell installers with:

```bash
POLYLANE_VERSION=v0.1.0 curl -fsSL https://polylane.com/install.sh | bash
$env:POLYLANE_VERSION='v0.1.0'; irm https://polylane.com/install.ps1 | iex
```

### Wire it into your coding agents

```bash
polylane setup                            # configure every detected agent
polylane setup --agent claude --agent cursor   # target specific agents
polylane setup --project                  # this project instead of the home directory
```

`setup` detects installed coding agents and configures each one: it installs the bundled [agent skill](skill/SKILL.md) where the agent supports skills, and registers the Polylane MCP server (`https://mcp.polylane.com/mcp`) in the agent's own config format.

| Agent | Agent skill | MCP server |
|---|---|---|
| Claude Code | `~/.claude/skills/polylane-cli/` | `~/.claude.json` |
| Cursor | `~/.cursor/skills/polylane-cli/` | `~/.cursor/mcp.json` |
| OpenCode | `~/.config/opencode/skills/polylane-cli/` | `~/.config/opencode/opencode.json` |
| Codex CLI | `~/.codex/skills/polylane-cli/` | `~/.codex/config.toml` |
| Pi | `~/.pi/agent/skills/polylane-cli/` | `~/.pi/agent/mcp.json` |
| Warp | `~/.warp/skills/polylane-cli/` | `~/.warp/.mcp.json` |
| Windsurf | — | `~/.codeium/windsurf/mcp_config.json` |
| Zed | — | `~/.config/zed/settings.json` |
| VS Code | — | user profile `mcp.json` |

It is idempotent: the skill is overwritten with the version bundled in the CLI, an existing MCP entry is left untouched, and unreadable config files are skipped with a manual pointer instead of clobbered. The curl installer runs it automatically after install (opt out with `--no-setup`).

The skill alone, without the CLI: `npx skills add coreplanelabs/cli`.

## Quick start

```bash
# 1. Authenticate (pick one)
polylane auth login                            # OAuth browser (the default)
polylane auth login --no-browser               # OAuth device code (SSH / headless)
polylane auth login --api-key sk_xxxxx         # API key (CI / scripts where OAuth is impossible)
polylane auth signup                           # create an account: Google, GitHub, or email
                                              # (email signup sends a 6-digit code; enter it
                                              # at the prompt or re-run with --code <code>)

# 2. Workspace
polylane workspace create --name "My Workspace"   # creates + makes default
# or: polylane workspace use <workspace-id>

# 3. Connect your stack (discover what's available first)
polylane integration catalog
polylane integration connect --type <type>        # see `polylane integration connect --help`
polylane cloud connect --provider <provider>      # see `polylane cloud connect --help`

# 4. Work
polylane issue list --active                      # what the system is flagging
polylane thread list --type investigation         # investigation threads
polylane issue note <issue-id> "rolled back deploy"
polylane service logs <service> --since 1h --grep error
polylane tools run findNodes --params '{"query":"api"}'
polylane thread ask "<prompt>" --stream
polylane memory save "<finding>"
```

## Discovering commands

Run `polylane --help` for the resource list, `polylane <resource> --help` for its commands, and `polylane <resource> <command> --help` for flags and examples. Help is the authoritative source — it reflects the installed version, this document does not.

For the full API surface not yet exposed as first-class commands:

```bash
polylane api list                     # browse every operation
polylane api list --tag Issues        # filter by tag
polylane api describe <operation-id>  # show its shape
polylane api call <operation-id> [--body '{...}' | --body-file path]
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
polylane ... --non-interactive --quiet --output json
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
| `POLYLANE_API_DOMAIN` | API hostname (no protocol) |
| `POLYLANE_API_KEY` | API key |
| `POLYLANE_WORKSPACE_ID` | Default workspace |
| `POLYLANE_OUTPUT` | `text` or `json` (overrides TTY auto-detect) |
| `POLYLANE_TIMEOUT` | Request timeout (seconds) |
| `POLYLANE_VERBOSE` | Enable verbose HTTP logging |
| `POLYLANE_TELEMETRY` | `0` / `false` / `off` disables anonymous usage telemetry |
| `POLYLANE_TELEMETRY_ENDPOINT` | Override the telemetry endpoint (defaults to `<api>/v1/telemetry/cli`) |
| `DO_NOT_TRACK` | Universal `1` disables telemetry ([standard](https://consoledonottrack.com/)) |
| `POLYLANE_OAUTH_CLIENT_ID` / `POLYLANE_OAUTH_CLIENT_SECRET` | OAuth client override (normally baked at build) |
| `POLYLANE_CONSOLE_DOMAIN` | Consent-UI host override (defaults to the API host with `api.` → `console.`) |
| `NO_COLOR` | Disable ANSI colours |

## Configuration file

`~/.polylane/config.json` (mode `0600`):

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

Manage with `polylane config show` and `polylane config set --key <key> --value <value>`.

## Authentication

OAuth is the default way to connect — including for agents. Use an API key only where a browser sign-in is impossible.

| Command | When |
|---|---|
| `polylane auth login` | Interactive OAuth (browser, PKCE) — the default |
| `polylane auth login --no-browser` | OAuth device code (SSH / headless) |
| `polylane auth login --api-key sk_...` | Scripts / CI / machines that cannot complete OAuth |
| `polylane auth signup` | Create an account — Google/GitHub (one browser trip: signup + CLI OAuth) or email + password |
| `polylane auth signup --email … --password …` | Bootstrap a fresh account from an agent; finish with `--code <code>` from the verification email |

OAuth credentials live at `~/.polylane/credentials.json` (mode `0600`) and auto-refresh before expiry. `polylane auth status` reports the active source.

For account lifecycle operations beyond signup/login (reset password, update profile, delete account, notification settings) — use the web console. They're available via `polylane api call <op>` if you really need them from the CLI, but they're not first-class commands.

## Telemetry

Anonymous usage telemetry is **on by default**. One event per command (name, flag *names*, exit code, duration, CLI/Node/OS versions, workspace ID, auth method class). Never argument values, credentials, or user identity.

```bash
polylane telemetry status         # see exactly what's collected and where it goes
polylane telemetry disable        # opt out (persisted)
POLYLANE_TELEMETRY=0 polylane ...  # per-invocation opt-out
DO_NOT_TRACK=1 polylane ...       # universal opt-out
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
npm run codegen      # fetch spec from $POLYLANE_API_DOMAIN/v1/doc
npm run typecheck
npm run lint
npm run test
npm run build        # codegen + esbuild → dist/polylane.mjs
```

The HTTP client is generated at build time from the OpenAPI spec. Top-level commands hand-craft the agent UX on top of it.

## License

[MIT](LICENSE)
