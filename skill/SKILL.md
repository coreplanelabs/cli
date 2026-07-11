---
name: polylane-cli
description: Use `polylane` to investigate incidents, explore cloud infrastructure (logs / metrics / dependency graphs), search code, save memories, run automations from a catalog, connect observability tools and cloud accounts, and drive threads with the Polylane agent. Use when the user wants to debug a production issue, look up a service, search their codebase, manage integrations, connect a cloud provider, or talk to the Polylane agent from the terminal.
---

# Polylane CLI — Agent Skill Guide

`polylane` wraps the Polylane platform with agent-friendly commands. Top-level commands map to tasks an agent actually performs; the full API surface is available under `polylane api` as an escape hatch.

> **Full docs: <https://docs.polylane.com>** (model-readable, no auth required). Start at
> <https://docs.polylane.com/getting-started>, and see <https://docs.polylane.com/llms.txt> for an
> agent-oriented index. This skill is the quick reference; the docs are the source of truth for
> concepts, the automation schema (triggers / actions / destinations), and the full API. When a task
> goes beyond what's below, read the docs rather than guessing.

## Prerequisites

```bash
# Install (pick one — see README for the full list)
npm install -g @coreplane/polylane
# curl -fsSL https://polylane.com/install.sh | bash
# brew install coreplanelabs/polylane

# Pick ONE auth path:
polylane auth login --api-key sk_xxxxx                 # API key — scripts / CI
polylane auth login                                    # OAuth browser (PKCE)
polylane auth login --no-browser                       # OAuth device code (SSH / headless)
polylane auth signup --email <email> --password <pw>   # bootstrap an account from an agent

# Verify
polylane auth status
```

**API key** persists to `~/.polylane/config.json`. **OAuth** credentials persist to `~/.polylane/credentials.json` (mode `0600`) and auto-refresh before expiry. **Signup** stores a server-issued session token under the same OAuth credential shape — for long-lived agent access, create an API key right after signup and switch to it.

Account-lifecycle operations beyond signup/login (verify email, reset password, update profile, delete account, notification settings) live in the web console. Reach them from the CLI via `polylane api call <op>` if you must.

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
# 1. Account
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

# 5. Add automations from templates
polylane automation catalog
polylane automation from-template <slug>

# 6. Verify
polylane integration list
polylane cloud list
polylane service list                             # cloud infra discovered from connected accounts
polylane automation list
```

`integration connect` and `cloud connect` dispatch on `--type` / `--provider`. Some options open a browser for an install URL; others take API credentials directly. Use `--help` on each to see the required flags and optional `--no-browser`.

### Investigating an incident

```bash
polylane issue list --active                      # what's currently flagged
polylane issue show <issue-id>                    # full body + linked incident
polylane thread list --type incident              # active incident threads
polylane thread show <thread-id>                  # the incident thread with Console / Next footer
polylane incident timeline <thread-id>             # who did what, when
polylane incident note <thread-id> "rolled back deploy ABC"
polylane incident milestone <thread-id> "Mitigated"

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
# Start a thread (blocking — returns the full reply)
polylane thread ask "<prompt>" [--context <comma-separated-ids>]

# Start a thread (streaming — tokens stream to stdout)
polylane thread ask "<prompt>" --stream

# Fire-and-forget — returns 202, poll later
TID=$(polylane thread ask "<prompt>" --no-wait --output json --quiet | jq -r '.id')

# Follow up
polylane thread continue <thread-id> "<prompt>"
```

Attach resources as context by passing their IDs — the CLI infers the resource type from the ID prefix.

### Automations

An automation is **trigger → instructions → tools → actions**: a typed event fires, an agent runs
with your instructions and a set of skills (tools), and optional actions apply side-effects (open an
incident, roll back a deploy, open a PR) — each gated by a `mode` (`smart` = act only when warranted,
`always`). Full schema and every trigger/action type: <https://docs.polylane.com/fix-and-automate/automations>.

```bash
polylane automation catalog                       # browse prebuilt templates
polylane automation from-template <slug>          # create from a template
polylane automation from-template <slug> --pass-count 2 --provider cloudflare
polylane automation create ...                    # create an ARBITRARY automation (see below)

polylane automation list
polylane automation trigger <automation-id>       # manual run
polylane automation executions <automation-id>    # list runs
polylane automation execution <automation-id> <execution-id>   # one run + result
polylane automation rerun <automation-id> <execution-id>
```

**Templates vs. custom.** Use `from-template` when a catalog entry matches as-is. Use
`automation create` for anything else — a scoped trigger, custom instructions, a combination no
template covers. `automation create` is a first-class command; you do **not** need `polylane api call`.

```bash
# Build from flags. --trigger/--action take JSON, or a bare type for filterless ones (e.g. `webhook`).
# --tool attaches a skill by slug (repeatable); see `polylane skill list`.
polylane automation create \
  --name "Triage Datadog alerts" \
  --trigger '{"type":"alert","filters":{"sources":["datadog"]}}' \
  --instructions "Correlate the alert with recent deploys and open an incident with the findings." \
  --tool investigate-errors --tool investigate-latency \
  --action '{"type":"openIncident","mode":"smart","defaultSeverity":"high"}' \
  --delay 600000            # wait 10m (e.g. let a deploy settle) before the run

# Or pass a full JSON body (--body-file '-' reads stdin); flags layer on top.
polylane automation create --body-file automation.json

# Scope a template's broad trigger: crib its body, then narrow the trigger.
polylane automation catalog --output json                       # find the slug + shape
polylane automation create --body-file template.json \
  --trigger '{"type":"cloudflare.deployment","filters":{"environments":["production"]}}'
```

Run `polylane automation create --help` for every flag. Common trigger types: `alert`, `cron`
(`{"type":"cron","expression":"0 9 * * *"}`), `webhook`, `github.*` (push/pull_request/deployment/…),
`{cloudflare,vercel,render,fly}.deployment`, `slack.message`, `polylane.*` (cloud_account.synced,
codebase.synced, …). Actions include `openIncident`, `rollback{Cloudflare,Vercel,Render,Fly}Deployment`,
`submitPr`, `commentPr`, `mergePr`, `createIssue`, `autofix`, `handoffTo{Devin,Cursor}`. The
authoritative, always-current list of types and filters is in the docs and in
`polylane api describe automations.post`.

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

**CLI flags > environment variables > `~/.polylane/config.json` > defaults.**

| Variable | Purpose |
|---|---|
| `POLYLANE_API_DOMAIN` | API hostname (no protocol) |
| `POLYLANE_API_KEY` | API key |
| `POLYLANE_WORKSPACE_ID` | Default workspace |
| `POLYLANE_OUTPUT` | `text` or `json` (overrides TTY auto-detect) |
| `POLYLANE_TIMEOUT` | Request timeout (seconds) |
| `POLYLANE_VERBOSE` | Verbose HTTP logs |
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
| 130 | Interrupted (Ctrl-C) |

See [ERRORS.md](../ERRORS.md) for categories, envelope shape, and the patterns agents should branch on.
