# Polylane CLI Error Reference

Categories of errors the CLI can emit, their exit codes, and what to do about them. For command-specific error messages, the authoritative source is always `polylane <command> --help` and the command's actual stderr output — this document lists the **shapes** and **categories** an agent can branch on.

- [Exit codes](#exit-codes)
- [Error envelope](#error-envelope)
- [Global error categories](#global-error-categories)
- [Per-command patterns](#per-command-patterns)
- [Debugging](#debugging)

---

## Exit codes

Exit codes are part of the CLI contract — they change rarely. Branch on `$?` after any `polylane` call to decide whether to retry, re-auth, or surface to the user.

| Code | Name | Meaning |
|---|---|---|
| 0 | SUCCESS | Command completed successfully |
| 1 | GENERAL | Unexpected error, 4xx / 5xx with no more specific category |
| 2 | USAGE | Invalid flag, missing required arg, bad JSON body |
| 3 | AUTH | 401 / 403 from API, missing credentials, expired OAuth token that couldn't refresh |
| 4 | QUOTA | 429 (rate limit) or 426 (plan upgrade required) |
| 5 | TIMEOUT | Request timed out |
| 6 | NETWORK | DNS failure, connection refused, TLS error |
| 7 | PENDING | Command finished but the requested state is not reached yet (e.g. `cloud connect --provider aws` while the CloudFormation stack is still creating); re-check with the matching `list` command |
| 130 | — | Ctrl-C (SIGINT) |

## Error envelope

Every error is written to stderr as:

```
Error: <message>
Hint: <the exact command that fixes it>
```

In `--output json` mode the same information is emitted as:

```json
{ "error": { "code": <exit-code>, "message": "<message>", "hint": "<hint>" } }
```

An agent should read stderr (not stdout) for errors. stdout stays reserved for clean data / JSON.

---

## Global error categories

Every command inherits these. Specific messages are subject to change, but the **category** (and therefore the exit code) is stable.

### Network (exit `6` or `5`)

| Scenario | Exit | Typical message |
|---|---|---|
| DNS / connection failure | 6 | `Network error: …` with a hint pointing at `--domain` |
| Request aborted | 5 | `Request aborted` |
| Request timed out | 5 | `Request timed out` with a hint to raise `--timeout` |
| HTTP 408 / 504 from API | 5 | surfaced via the envelope, exit `TIMEOUT` |

### Authentication / authorisation (exit `3`)

| Scenario | Typical message |
|---|---|
| No credentials | `Not signed in.` with a hint listing `auth login` variants |
| HTTP 401 | `Not signed in.` |
| HTTP 403 | `Permission denied` |
| OAuth refresh failed | `Couldn't refresh your session (<status>)` with a hint to sign in again |
| WebSocket upgrade rejected (for streaming commands) | `WebSocket upgrade rejected (<status>)` |

### Rate limit / plan (exit `4`)

| Scenario | Typical message |
|---|---|
| HTTP 429 | `Rate limited` + any `Retry-After` |
| HTTP 426 | `Plan upgrade required` |

### Usage (exit `2`)

| Scenario | Typical message |
|---|---|
| Unknown command | `Unknown command: polylane <path>`, plus `Closest match: polylane <command>` when one is close, with a hint pointing at `polylane --help` |
| Unknown flag | `Unknown flag: <flag>` |
| Flag requires a value | `Flag <flag> requires a value` |
| Flag expects a number | `Flag <flag> expects a number, got "<value>"` |
| Missing required positional | `Missing required argument: <name>` |
| Missing required flag (non-interactive) | `Missing required flag: <flag>` |
| Invalid domain / workspace ID / timeout / output format | per-validator error with a hint |
| `--body` invalid JSON | `Invalid JSON in --body: <message>` |
| `--body-file` unreadable | bubbled fs error (`ENOENT`, `EACCES`, …) |
| Destructive command without `--yes` in non-interactive mode | `Confirmation required` with a hint to re-run with `--yes` |

### Workspace context (exit `2`)

When the current command is workspace-scoped and no workspace is available:

```
Error: No workspace set
Hint: polylane workspace use <id>
        --workspace <id>
        POLYLANE_WORKSPACE_ID=<id>
```

### Config / credentials file corruption

| Scenario | Behaviour |
|---|---|
| `~/.polylane/config.json` unparseable | Treated as empty config; warning to stderr |
| `~/.polylane/credentials.json` unparseable | Treated as no credentials; warning to stderr |
| `~/.polylane/credentials.json` mode not `0600` | Warning printed; file is still read |

### Signals

| Scenario | Exit | Behaviour |
|---|---|---|
| Ctrl-C / SIGINT | 130 | `Interrupted`; any in-flight request is aborted |

---

## Per-command patterns

These are the non-obvious command-level behaviours an agent should know about. Specific error strings are subject to change — use these as categories you can rely on.

### Destructive operations (`auth logout`, `integration disconnect`, `cloud disconnect`, `memory delete`, …)

- Prompt for confirmation in interactive mode.
- Require `--yes` in non-interactive mode, else exit `2`.
- A cancelled confirmation exits `0` (not an error) with `Cancelled` on stderr.

### Idempotent operations

- `auth signup` is idempotent for an existing user with a matching password: it returns a fresh session token instead of an error. Agents can call it again to renew.

### Partial-success responses

Some connect-style operations may return `{ accounts: [...], failures: [...] }` with both arrays non-empty. The exit code is still `0`; inspect the `failures` array in the body.

### Browser-opening operations

Commands that generate an install / consent URL (`auth login`, `integration connect --type <browser-flow>`, `cloud connect --provider <browser-flow>`, …) always print the URL to stdout and, in interactive mode, also try to open the browser. They succeed whether or not the browser actually opens. When the command can wait for the upstream side to finish (`integration connect`, `cloud connect`), the exit code reflects that wait: `0` once the connection shows up, `1` when the wait timed out, `7` when `cloud connect --provider aws` ends while the CloudFormation stack is still creating (the account arrives later; `polylane cloud list` shows it). After a browser flow, re-query state with the relevant `list` / `show` command to confirm.

### Pending (exit `7`)

| Scenario | Exit | Typical message |
|---|---|---|
| `cloud connect --provider aws` ends before the CloudFormation stack finishes creating | 7 | `AWS is still connecting — the CloudFormation stack has not shown up yet.` with a hint to check `polylane cloud list` |

`7` is not an error: the launch went through and nothing needs to be re-run unless the stack fails. Treat it as "not connected yet" and re-check with `polylane cloud list` before depending on the account.

### Streaming commands (`thread ask --stream`, `thread continue --stream`)

- Open a WebSocket to the thread; tokens stream to stdout as produced.
- Upgrade failures (401 / 403) exit `3`; other WebSocket errors exit `6`.
- `--no-wait` returns immediately with `{ id, status: "accepted" }` (exit `0`) and does not stream.

### Time-bounded session tokens

- `auth signup` returns a server-issued session token. The actual expiry is read from the response `Set-Cookie` `Expires=` attribute and honoured by `auth status`.
- After expiry the next call exits `3` with a hint to re-authenticate (re-run `auth signup` with the same credentials, or switch to an API key).

### Invalid operation IDs for `polylane api call` / `polylane api describe`

Exit `2` with `Unknown operation: <id>` and a hint pointing at `polylane api list`.

---

## Debugging

```bash
# Show HTTP method/URL and response status
polylane <command> --verbose

# Preview the request without sending
polylane <command> --dry-run --verbose

# Inspect your live config + auth state
polylane config show
polylane auth status
```

When reporting a bug, include the `--verbose` trace and the redacted output of `polylane config show`.
