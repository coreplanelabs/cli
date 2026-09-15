---
name: polylane-cli
description: Use `polylane` to investigate production issues, explore cloud infrastructure (logs / metrics / dependency graphs), search code, save memories, connect observability tools and cloud accounts, and drive threads with the Polylane agent. Use when the user wants to debug a production issue, look up a service, search their codebase, manage integrations, connect a cloud provider, or talk to the Polylane agent from the terminal.
---

# Polylane CLI — Agent Skill Guide

`polylane` wraps the Polylane platform with agent-friendly commands. Top-level commands map to tasks an agent actually performs; the full API surface is available under `polylane api` as an escape hatch.

> **Full docs: <https://docs.polylane.com>** (model-readable, no auth required). Start at
> <https://docs.polylane.com/getting-started>, and see <https://docs.polylane.com/llms.txt> for an
> agent-oriented index. This skill is the quick reference; the docs are the source of truth for
> concepts and the full API. When a task goes beyond what's below, read the docs rather than guessing.

## Prerequisites

```bash
# Install (pick one — see README for the full list)
npm install -g @coreplane/polylane
# curl -fsSL https://polylane.com/install.sh | bash
# brew install coreplanelabs/tap/polylane

# Pick ONE auth path (OAuth is the default; use an API key only where a browser sign-in is impossible):
polylane auth login                                    # OAuth browser (PKCE) — the default
polylane auth login --no-browser                       # OAuth device code (SSH / headless)
polylane auth login --api-key sk_xxxxx                 # API key — scripts / CI without OAuth
polylane auth signup --email <email>                   # bootstrap an account: generates a strong password, shown once (emails a 6-digit code)
polylane auth signup --email <email> --code <code>     # finish signup with the emailed code

# Verify
polylane auth status
```

**API key** persists to `~/.polylane/config.json`. **OAuth** credentials persist to `~/.polylane/credentials.json` (mode `0600`) and auto-refresh before expiry. Credential precedence: `--api-key` flag > `POLYLANE_API_KEY` > `~/.polylane/credentials.json` > `api_key` in `~/.polylane/config.json` (an exported key always beats a stale OAuth token). **Signup** generates a strong random password when `--password` is omitted and prints it once on stderr (also `generated_password` in JSON output); store it, or change it later via password reset. Weak or known-leaked passwords are challenged at the edge (exit `2`, "challenged by the edge, usually because the password is weak or known-leaked"): do not invent one, let the CLI generate it. Signup emails a 6-digit verification code to the address; the account is unusable until the code is confirmed (interactively, or with `--code`). The confirmed session token is stored under the same OAuth credential shape — for long-lived agent access, create an API key right after signup and switch to it.

Account-lifecycle operations beyond signup/login (reset password, update profile, delete account, notification settings) live in the web console. Reach them from the CLI via `polylane api call <op>` if you must.

Every workspace-scoped command needs a workspace. Set one once, then forget:

```bash
polylane workspace list
polylane workspace use <workspace-id-or-slug>
polylane workspace create --name "My Workspace"   # new + makes default
```

## Discovering commands

Help is authoritative — it reflects the installed version.

```bash
polylane --help                                  # resource list
polylane <resource> --help                       # verbs for a resource
polylane <resource> <verb> --help                # flags + examples for one command
```

For anything not yet a first-class command:

```bash
polylane api list                                # every operation
polylane api list --tag <Tag>                    # filter by OpenAPI tag
polylane api describe <operation-id>             # show its shape
polylane api call <operation-id> [--body '{...}' | --body-file path]
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
Console:  https://console.polylane.com/…
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
polylane ... --quiet 2>/dev/null                  # silence everything but data
polylane ... --output json | jq '...'             # pipe clean JSON
```

---

## Core workflows

The best way to learn a command is `polylane <resource> <verb> --help`. These workflows show the shape of an agent session.

### Onboarding a new account

```bash
# 1. Account (a strong password is generated and printed once; a 6-digit
#    verification code is emailed; enter it at the prompt or finish with
#    `polylane auth signup --email you@example.com --code <code>`)
polylane auth signup --email you@example.com
# or: polylane auth login

# 2. Workspace
polylane workspace create --name "Acme"

# 3. Discover what you can connect
polylane integration catalog                      # all types
polylane integration catalog --category tool
polylane integration catalog --category cloud

# 4. Connect — each type has its own required flags
polylane integration connect --type <type>        # see --help for that type
polylane cloud connect --provider <provider>      # see --help for that provider

# 5. Verify
polylane integration list
polylane cloud list
polylane service list                             # cloud infra discovered from connected accounts
```

`integration connect` and `cloud connect` dispatch on `--type` / `--provider`. Some options open a browser for an install URL; others take API credentials directly. Use `--help` on each to see the required flags and optional `--no-browser`. Browser flows wait in the terminal until the connection appears (interactive TTY only); with `--output json` or in non-interactive runs they print the URL and exit, so poll `integration list` / `cloud list` to confirm.

Plans cap how many cloud accounts a workspace can connect; the numbers come from the API, never from the CLI. `cloud connect` checks first: with room it connects; at the limit it names the plan and the count (`Your Free plan includes 2 cloud accounts; 2 connected.`), offers the cheapest plan that raises it, and on yes opens Stripe Checkout and waits, then carries on with the connect once the plan lands. A no, a Stripe cancel, or no answer in time exits `4` with `Upgrade any time: polylane subscription upgrade` and leaves the connected accounts as they are. Non-interactive runs at the limit exit `4` with the same line as an error. The API answers a connect over the limit with `402` (exit `4`) either way.

```bash
polylane subscription plans                       # catalog: prices and limits, no sign-in needed
polylane subscription show                        # this workspace: plan, cloud accounts used of allowed, credits
polylane subscription upgrade --plan starter      # Stripe Checkout in the browser; waits for the plan to land
polylane subscription manage                      # billing portal: invoices, payment method, change or cancel
```

`subscription upgrade` prints the checkout URL, opens it, and waits (TTY only) for either the browser to return to the CLI's local listener or the plan to change. Exit `0` once upgraded, `1` on a Stripe cancel or a timeout, `7` when the payment went through but the plan has not flipped yet (re-check with `subscription show`). With `--output json` or without a TTY it prints `{ "url": … }` and exits.

`integration connect --type github` asks one question before opening GitHub: review pull requests for production impact on the repositories this connection brings in (default yes). Pass `--no-pr-reviews` to opt out, or `--pr-reviews` to answer yes, without the prompt; non-interactive runs without either flag keep the default. Each repository can be changed later in the console.

### Investigating an issue

```bash
polylane issue list --active                      # what's currently flagged
polylane issue show <issue-id>                    # full body + linked investigation
polylane thread list --type investigation         # active investigation threads
polylane thread show <thread-id>                  # the investigation thread with Console / Next footer
polylane issue timeline <issue-id>                # who did what, when
polylane issue note <issue-id> "rolled back deploy ABC"
polylane issue milestone <issue-id> "Mitigated"

# Drill into services
polylane service find "<query>"
polylane service logs <service-id> --since 1h --grep error
polylane service metrics <service-id> --metric <name> --since 1h
polylane service graph <service-id> --direction both --depth 1

# Search code
polylane repo find "<query>"
polylane repo grep <owner/repo> "<regex>"

# Save what you learned
polylane memory save "<finding>"
```

### Running agent tools directly

Polylane exposes the same tools its own agent uses — observability queries across every connected provider, infra-graph traversal, code and change-record search, deployments, audit logs. Discover them, then run them, without opening a thread.

```bash
# Discover tools available to this workspace (filtered to your credential's scopes)
polylane tools search                              # browse everything
polylane tools search "cloudflare logs" --full     # keyword search + full JSON schemas

# Run one tool by name (args as a JSON object matching its schema)
polylane tools run findNodes --params '{"query":"api"}'
polylane tools run cloudflareRunTelemetryQuery --params '{"account":"...","dataset":"..."}'

# Chain several tools in one call
polylane tools code 'async () => { const n = await tools.findNodes({ query: "api" }); return n; }'
polylane tools code --file query.ts
```

Read-only by default. Write-capable tools need a key/token with the `agent_tools:write` scope plus the `--write` flag; each write is screened by a safety model.

### Talking to the agent

```bash
# Start a thread (text mode streams the reply to stdout as it is generated)
polylane thread ask "<prompt>" [--context <comma-separated-ids>]

# Wait for the complete reply as JSON
polylane thread ask "<prompt>" --output json

# Fire-and-forget — returns 202, poll later
TID=$(polylane thread ask "<prompt>" --no-wait --output json --quiet | jq -r '.id')

# Follow up
polylane thread continue <thread-id> "<prompt>"
```

Attach resources as context by passing their IDs — the CLI infers the resource type from the ID prefix.

---

## Piping patterns

```bash
# Extract a field
polylane workspace list --output json | jq '.items[0].id'

# Chain: find a service → check its logs
SVC=$(polylane service find "payment lambda" --output json --quiet | jq -r '.items[0].id')
polylane service logs "$SVC" --since 1h --grep error

# Fire-and-forget + later poll
TID=$(polylane thread ask "<prompt>" --no-wait --output json --quiet | jq -r '.id')
polylane thread show "$TID" --output json | jq '.messages[-1]'

# Silence everything but data
polylane issue list --quiet 2>/dev/null
```

---

## Configuration precedence

**CLI flags > environment variables > `~/.polylane/config.json` > defaults.** For credentials specifically: `--api-key` > `POLYLANE_API_KEY` > `~/.polylane/credentials.json` (OAuth) > `api_key` in `~/.polylane/config.json`.

| Variable | Purpose |
|---|---|
| `POLYLANE_API_DOMAIN` | API hostname (no protocol) |
| `POLYLANE_API_KEY` | API key |
| `POLYLANE_WORKSPACE_ID` | Default workspace |
| `POLYLANE_OUTPUT` | `text` or `json` (overrides TTY auto-detect) |
| `POLYLANE_TIMEOUT` | Request timeout (seconds) |
| `POLYLANE_VERBOSE` | Verbose HTTP logs |
| `POLYLANE_HINTS` | `0` / `false` / `off` suppresses next-step hints (guidance only) |
| `POLYLANE_TELEMETRY` | `0` / `false` / `off` disables anonymous telemetry |
| `DO_NOT_TRACK` | `1` — universal opt-out |
| `NO_COLOR` | Disable ANSI colours |

---

## Telemetry

Anonymous usage telemetry is on by default. `polylane telemetry status` prints exactly what gets sent; `polylane telemetry disable` opts out. Agents running in CI can set `POLYLANE_TELEMETRY=0` or `DO_NOT_TRACK=1` in the environment. Full detail in [PRIVACY.md](../PRIVACY.md).

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
| 7 | Pending (finished, but not yet complete upstream: re-check with `list`) |
| 130 | Interrupted (Ctrl-C) |

See [ERRORS.md](../ERRORS.md) for categories, envelope shape, and the patterns agents should branch on.
