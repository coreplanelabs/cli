# AGENTS.md — Agent Coding Guidelines

Guidance for AI coding assistants working **on** this repo. For guidance on how to *use* the CLI as an agent, see [skill/SKILL.md](skill/SKILL.md).

## Project overview

- **Name:** `@coreplane/nominal` on npm — binary still invoked as `nominal`
- **Type:** Node.js CLI tool (ESM, bundled with esbuild)
- **Engine:** Node.js 18+ (ships as a single bundled file; dev tooling needs a recent Node)
- **Language:** TypeScript, strict mode
- Runtime deps are intentionally minimal — check `package.json` before adding a new one.

## Design philosophy

**This CLI is for agents, not humans.**

- Top-level resources are nouns; each has 2–10 agent-oriented verbs. Verbs are tasks agents actually do, not thin wrappers around HTTP methods. For the current resource/verb surface, run `nominal --help`.
- `nominal --help` stays short (≤ 35 lines). Compact root help is load-bearing.
- List commands return **narrow projections** by default (`--full` to opt out).
- Single-object reads include a `Console: …` / `Next: …` footer surfacing `_html_url` and `_links`.
- Positional args for "the obvious thing" (IDs, prompts); flags for everything else.
- JSON when piped, text in TTY; `--output` always overrides.
- Every error ends with the exact command that fixes it.
- The full API surface lives under `nominal api call <operationId>` as an escape hatch — wrap an op only when it earns a first-class command.

## Commands (build, lint, test)

```bash
# Install
npm install

# Regenerate HTTP client from the OpenAPI spec
npm run codegen

# Type check (strict, must pass before merging)
npm run typecheck

# Lint
npm run lint

# Tests (node --test with tsx loader — does not load .env.local)
npm run test
npm run test:watch

# Dev server (loads .env.local if present)
npm run dev -- <command> [args...]

# Production-style build (codegen + esbuild → dist/nominal.mjs)
npm run build
```

A dev build bakes every `NOMINAL_*` env var it sees (from `.env.local` or shell) into the bundle via esbuild `define`. CI publishes use GitHub Actions secrets the same way. Prod checkouts without a `.env.local` ship source defaults.

## Code style

### TypeScript

- **Strict mode.**
- **No `any`.** Use `unknown` only at trust boundaries (catch clauses, JSON parsing, dynamic dispatch via the generated client).
- **No silent unused vars.** Prefix with `_` if intentionally unused (e.g. `_flags`).
- **No JSDoc or comments** unless the logic is non-obvious.

### Imports

Order: external → internal absolute → relative. Group by imports → types → constants → functions.

### File naming

- Files & directories: `kebab-case`.
- Test files: `test/<topic>.test.ts`.
- Command files live under `src/commands/<resource>/<verb>.ts`.

### Naming conventions

- Functions: `camelCase`.
- Constants: `SCREAMING_SNAKE_CASE`.
- Interfaces / types: `PascalCase`.
- Command exports: `<resource><Verb>Command`.

### Error handling

Throw `CLIError` (`src/errors/base.ts`) for anything user-actionable. Always pass an `ExitCode` and, when useful, a `hint` string. Let `handleError` at the main-loop level own the rendering.

```ts
throw new CLIError(
  'No workspace set',
  ExitCode.USAGE,
  'nominal workspace use <id>\n' +
    'or pass --workspace <id>\n' +
    'or set NOMINAL_WORKSPACE_ID=<id>'
);
```

### Async / await

Always `await`; never `.then()` chains. Catch at command-level if cleanup is needed (e.g. stop a spinner), otherwise let `handleError` catch.

### Output

Use the output helpers (`src/output/`). Respect `--output`, `--quiet`, `--verbose`. **Never write progress/spinners to stdout — only stderr. stdout is pure data.**

### Testing

Node's built-in test runner with the tsx loader. Co-locate under `test/`. Clear stateful env (`delete process.env.NOMINAL_*`) in `beforeEach` when touching config / auth. Tests deliberately don't load `.env.local` — they verify defaults.

### Git conventions

- Commit format: `<type>: <description>` — `feat`, `fix`, `refactor`, `docs`, `test`, `chore`.
- Keep commits atomic. Never bundle a feature with a drive-by rename.
- Don't commit `.env.local`, `dist/`, or anything under `src/generated/`.

## Project layout

Top-level:

```
src/         source code
codegen/     OpenAPI → TypeScript code generator
test/        Node-native tests
skill/       Agent-facing usage reference (SKILL.md)
build.ts     Build orchestrator (codegen + esbuild; loads .env.local)
```

Inside `src/`:

- `main.ts` / `args.ts` / `command.ts` / `registry.ts` — entry point, arg parser, command interface, command tree + compact help.
- `commands/<resource>/<verb>.ts` — one file per command. `commands/<resource>/index.ts` collects them; `commands/index.ts` registers every group.
- `commands/helpers.ts` — shared helpers (`requireWorkspace`, `requirePositional`, `parseDuration`, `promptIfMissing`, arg accessors).
- `client/http.ts` — auth-injecting `fetch` + envelope parsing.
- `client/thread-chat.ts` — durable-thread WebSocket streaming.
- `auth/` — credentials, OAuth (PKCE + device code), signup helpers.
- `config/` — schema, loader, paths.
- `errors/` — `CLIError`, exit codes, API error mapping, handler.
- `output/` — `formatter.ts` (with `_html_url`/`_links` footer), `text.ts`, `json.ts`, `progress.ts`, projection helpers.
- `utils/` — browser open, TTY detection, clack prompts, etc.
- `generated/` — **auto-generated, do not edit.** Regenerate with `npm run codegen`.

When in doubt, read the tree (`ls -R src/` or `nominal api list`) and follow the conventions of the files already there.

## Key patterns

### Defining a command

```ts
import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, requirePositional } from '../helpers';

export const serviceShowCommand: Command = {
  name: 'service show',
  description: 'Show a service with its properties',
  operationId: 'cloud_infra.nodes.get',
  positional: [{ name: 'service-id', description: 'Service identifier' }],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const id = requirePositional(args, 0, 'service-id');
    const api = new NominalAPI(config);
    formatOutput(config, await api.cloudInfraNodesGet(workspaceId, id));
  },
};
```

### Narrow projection for list commands

```ts
import { projectItems } from '../../output/project';
import { formatList } from '../../output/formatter';

const FIELDS = ['id', 'name', 'type', 'created', '_html_url'];

formatList(
  config,
  { items: projectItems(result.items, FIELDS), count: result.count },
  { headers: [...], rows: (item) => [...] }
);
```

### Surfacing `_html_url` and `_links`

The API returns `_html_url` (console deep link) and `_links` (next-step operations) on most resources. `formatOutput` and `formatSingle` strip them from the key-value dump and render a footer automatically. Don't re-render them manually. For list tables, opt in by including `_html_url` in your `FIELDS`.

### Using the generated client

```ts
const api = new NominalAPI(config);
await api.<methodName>(...);
```

Discover operation names with `nominal api list` or by searching `src/generated/client.ts`. Method names come from the `operationId` with dots / underscores / hyphens collapsed to camelCase.

### Browser-opening flows

Several commands generate an install / consent URL and open it. The pattern:

```ts
import { openBrowser } from '../../utils/browser';
import { isInteractive } from '../../utils/env';

const shouldOpen = !noBrowser && isInteractive(config.nonInteractive);
process.stdout.write(url + '\n');   // always print the URL (for logs / copy-paste)
if (shouldOpen) openBrowser(url);    // best-effort open
```

## Common tasks

### Add a new agent command

1. Pick the right resource group (or add one to `RESOURCE_ORDER` in `src/registry.ts`).
2. Create `src/commands/<resource>/<verb>.ts` exporting a `Command`.
3. Add the import + array entry to `src/commands/<resource>/index.ts`.
4. If the resource is new, wire its commands into `src/commands/index.ts`.
5. For list commands, define a narrow `FIELDS` projection.
6. Positional args for 1–2 obvious things; flags for the rest.
7. Add a test if the command does non-trivial work.
8. `npm run typecheck && npm run lint && npm run test`.

### Expose a new API endpoint

**Usually no code change needed.** After the spec updates, `npm run codegen` pulls in new operations — they become callable via `nominal api call <operationId>`.

Promote to a first-class command only if any of:

- Every agent using the CLI will use it.
- It needs custom UX (prompts, projection, smart ID resolution, browser-opening).
- It composes multiple API calls.

### Add a config key

1. Add the field to `Config` and `RawConfig` in `src/config/schema.ts`.
2. Validate it in the loader (`src/config/loader.ts`).
3. Handle it in `src/commands/config/set.ts`.
4. Document it in `README.md`.

### Add an error scenario

1. Throw a `CLIError` with the right `ExitCode` and a `hint`.
2. Add a row to the right section of `ERRORS.md` if it's a new category.

## Common pitfalls

1. **Don't edit `src/generated/`.** It's regenerated on every build.
2. **`requireWorkspace` first** in any workspace-scoped command.
3. **Every error needs a hint.** Tell the user the next command to run.
4. **Prefer positional args** for 1–2 required pieces of data.
5. **Narrow projection, not full objects**, in list commands. `--full` opts out.
6. **Run typecheck after every change.** Strict mode surfaces most bugs.
7. **Don't write to stdout from progress / spinners.** That corrupts piped JSON.
8. **Tests don't load `.env.local`.** If a test fails only locally but not in CI, check your env.
