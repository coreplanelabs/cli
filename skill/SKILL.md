---
name: nominal-cli
description: Use `nominal` to investigate incidents, explore cloud infrastructure (logs / metrics / dependency graphs), search code and wikis, save memories, run automations from a catalog, connect observability tools and cloud accounts, and drive threads with the Nominal agent. Use when the user wants to debug a production issue, look up a service, search their codebase, manage integrations, connect a cloud provider, or talk to the Nominal agent from the terminal.
---

# Nominal CLI — Agent Skill Guide

`nominal` wraps the Nominal platform with agent-friendly commands. Top-level commands map to tasks an agent actually performs; the full API surface is available under `nominal api` as an escape hatch.

## Prerequisites

```bash
# Install (pick one — see README for the full list)
npm install -g @coreplane/nominal
# curl -fsSL https://nominal.dev/install.sh | bash
# brew install coreplanelabs/nominal

# Pick ONE auth path:
nominal auth login --api-key sk_xxxxx                 # API key — scripts / CI
nominal auth login                                    # OAuth browser (PKCE)
nominal auth login --no-browser                       # OAuth device code (SSH / headless)
nominal auth signup --email <email> --password <pw>   # bootstrap an account from an agent

# Verify
nominal auth status
```

**API key** persists to `~/.nominal/config.json`. **OAuth** credentials persist to `~/.nominal/credentials.json` (mode `0600`) and auto-refresh before expiry. **Signup** stores a server-issued session token under the same OAuth credential shape — for long-lived agent access, create an API key right after signup and switch to it.

Account-lifecycle operations beyond signup/login (verify email, reset password, update profile, delete account, notification settings) live in the web console. Reach them from the CLI via `nominal api call <op>` if you must.

Every workspace-scoped command needs a workspace. Set one once, then forget:

```bash
nominal workspace list
nominal workspace use <workspace-id-or-slug>
nominal workspace create --name "My Workspace"   # new + makes default
```

## Discovering commands

Help is authoritative — it reflects the installed version.

```bash
nominal --help                                  # resource list
nominal <resource> --help                       # verbs for a resource
nominal <resource> <verb> --help                # flags + examples for one command
```

For anything not yet a first-class command:

```bash
nominal api list                                # every operation
nominal api list --tag <Tag>                    # filter by OpenAPI tag
nominal api describe <operation-id>             # show its shape
nominal api call <operation-id> [--body '{...}' | --body-file path]
```

## Agent flags

Combine these for non-interactive (agent / CI) contexts:

| Flag | Purpose |
|---|---|
| `--non-interactive` | Fail fast on missing args instead of prompting |
| `--quiet` | Suppress spinners / progress — stdout stays pure data |
| `--output json` | Force JSON regardless of TTY state |
| `--full` | Disable narrow projection on list commands |
| `--no-wait` | Return immediately (fire-and-forget) on `thread ask` / `thread continue` |
| `--stream` | Stream assistant tokens over WebSocket on `thread ask` / `thread continue` |
| `--dry-run` | Show the request without sending |
| `--verbose` | Log HTTP method / URL / response status |
| `--yes` | Skip destructive-action confirmation prompts |
| `--api-key <key>` | Override the stored API key per call |
| `--workspace <id>` | Override the default workspace per call |
| `--timeout <sec>` | Override the default timeout |

## Response shape

Every API response includes:

- **`_html_url`** — a console deep link (the UI page for this object)
- **`_links`** — a map of next-step operations (e.g. a thread's artifacts, participants, messages)

The CLI renders them as a footer when showing a single object:

```
Console:  https://console.nominal.dev/…
Next:
  <name>      <path>
  …
```

In JSON mode they're kept raw. In narrow list tables they're hidden unless included in the projection (use `--full` to see everything).

## stdout / stderr contract

- **stdout** is pure data. JSON responses, streamed tokens, table rows, file paths. Safe to pipe.
- **stderr** carries progress, spinners, confirmations, hints, error messages.

Combining patterns:

```bash
nominal ... --quiet 2>/dev/null                  # silence everything but data
nominal ... --output json | jq '...'             # pipe clean JSON
```

---

## Core workflows

The best way to learn a command is `nominal <resource> <verb> --help`. These workflows show the shape of an agent session.

### Onboarding a new account

```bash
# 1. Account
nominal auth signup --email you@example.com
# or: nominal auth login

# 2. Workspace
nominal workspace create --name "Acme"

# 3. Discover what you can connect
nominal integration catalog                      # all types
nominal integration catalog --category tool
nominal integration catalog --category cloud

# 4. Connect — each type has its own required flags
nominal integration connect --type <type>        # see --help for that type
nominal cloud connect --provider <provider>      # see --help for that provider

# 5. Add automations from templates
nominal automation catalog
nominal automation from-template <slug>

# 6. Verify
nominal integration list
nominal cloud list
nominal service list                             # cloud infra discovered from connected accounts
nominal automation list
```

`integration connect` and `cloud connect` dispatch on `--type` / `--provider`. Some options open a browser for an install URL; others take API credentials directly. Use `--help` on each to see the required flags and optional `--no-browser`.

### Investigating an incident

```bash
nominal cases                                    # open cases
nominal case show <case-id>                      # with Console / Next footer
nominal case investigate <case-id> "<prompt>"

# Drill into services
nominal service find "<query>"
nominal service logs <service-id> --since 1h --grep error
nominal service metrics <service-id> --metric <name> --since 1h
nominal service graph <service-id> --direction both --depth 1

# Search code and docs
nominal repo find "<query>"
nominal repo grep <owner/repo> "<regex>"
nominal wiki find "<query>"

# Save what you learned
nominal memory save "<finding>"
```

### Talking to the agent

```bash
# Start a thread (blocking — returns the full reply)
nominal thread ask "<prompt>" [--context <comma-separated-ids>]

# Start a thread (streaming — tokens stream to stdout)
nominal thread ask "<prompt>" --stream

# Fire-and-forget — returns 202, poll later
TID=$(nominal thread ask "<prompt>" --no-wait --output json --quiet | jq -r '.id')

# Follow up
nominal thread continue <thread-id> "<prompt>"
```

Attach resources as context by passing their IDs — the CLI infers the resource type from the ID prefix.

### Automations

```bash
nominal automation catalog                       # browse templates
nominal automation from-template <slug>          # one-command create

nominal automation list
nominal automation trigger <automation-id>       # manual run
nominal automation executions <automation-id>    # list runs
nominal automation execution <automation-id> <execution-id>   # one run + result
nominal automation rerun <automation-id> <execution-id>
```

For custom automations beyond the catalog, use `nominal api call automations.post --body-file automation.json`.

---

## Piping patterns

```bash
# Extract a field
nominal workspace list --output json | jq '.items[0].id'

# Chain: find a service → check its logs
SVC=$(nominal service find "payment lambda" --output json --quiet | jq -r '.items[0].id')
nominal service logs "$SVC" --since 1h --grep error

# Fire-and-forget + later poll
TID=$(nominal thread ask "<prompt>" --no-wait --output json --quiet | jq -r '.id')
nominal thread show "$TID" --output json | jq '.messages[-1]'

# Silence everything but data
nominal case list --quiet 2>/dev/null
```

---

## Configuration precedence

**CLI flags > environment variables > `~/.nominal/config.json` > defaults.**

| Variable | Purpose |
|---|---|
| `NOMINAL_API_DOMAIN` | API hostname (no protocol) |
| `NOMINAL_API_KEY` | API key |
| `NOMINAL_WORKSPACE_ID` | Default workspace |
| `NOMINAL_OUTPUT` | `text` or `json` (overrides TTY auto-detect) |
| `NOMINAL_TIMEOUT` | Request timeout (seconds) |
| `NOMINAL_VERBOSE` | Verbose HTTP logs |
| `NOMINAL_TELEMETRY` | `0` / `false` / `off` disables anonymous telemetry |
| `DO_NOT_TRACK` | `1` — universal opt-out |
| `NO_COLOR` | Disable ANSI colours |

---

## Telemetry

Anonymous usage telemetry is on by default. `nominal telemetry status` prints exactly what gets sent; `nominal telemetry disable` opts out. Agents running in CI can set `NOMINAL_TELEMETRY=0` or `DO_NOT_TRACK=1` in the environment. Full detail in [PRIVACY.md](../PRIVACY.md).

---

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
| 130 | Interrupted (Ctrl-C) |

See [ERRORS.md](../ERRORS.md) for categories, envelope shape, and the patterns agents should branch on.
