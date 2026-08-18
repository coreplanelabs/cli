# Review instructions

Review sessions MUST follow the required procedure below, in order, on every PR.

## Required procedure

1. Read the full diff, hunk by hunk.
2. For each changed function, grep the repo for its callers and references. Do not trust the diff alone.
3. Verify every claim in the PR body against the code.
4. Run the repo's checks locally instead of trusting CI: `npm ci`, then `npm run codegen`, `npm run typecheck`, `npm run lint`, `npm run test`. Repo-specific traps:
   - `npm run typecheck` runs codegen first (a `pretypecheck` hook) which fetches the live OpenAPI spec from `https://$POLYLANE_API_DOMAIN/v1/doc` (default `api.polylane.com`). No network means no typecheck, and a server-side spec change can break typecheck with zero code changes in the PR — attribute such failures correctly before blaming the diff.
   - `src/generated/` is gitignored: the client, types, and command metadata exist only after a successful `npm run codegen`, and most of `src/` (and the tests) import them.
   - `npm run lint` covers `src/` and `codegen/` only — `test/` files are not linted, so lint silence there is no signal.
   - CI runs the suite on Node 20.x, 22.x, and 24.x; a local pass on one version does not prove the others when the diff touches Node APIs or the built-in test runner.
   - When the diff touches `build.ts`, `codegen/`, `skill/SKILL.md`, or packaging, also run `npm run build` and smoke `./dist/polylane.mjs --version`. The build bakes any `POLYLANE_*` env vars it sees (shell or `.env.local`) into the bundle — verify with a clean environment.
5. Make a second adversarial pass over the riskiest files before writing the verdict.
6. Post findings as inline review comments anchored to the relevant lines, ordered by severity, with the summary as the review body.
7. Use execution where it helps: reproduce failures, run code in the sandbox, hit live APIs.

Speed rules. These bound scope and ordering; they never skip a step that applies:

- Start the slow checks first. Immediately after checkout, launch step 4 in the background (`npm ci`, then codegen, typecheck, lint, test) and do steps 1-3 while it runs. Collect the results once the reading passes are done.
- Tier by risk. If the diff touches only docs/markdown/copy and nothing that runs in production or CI, skip steps 4 and 7 and say so in the review body ("docs-only; no local checks apply"; in an approving review this phrase goes after the `LGTM:` token, since the auto-approve workflow keys on how the body starts). `skill/SKILL.md` does not qualify: codegen compiles it into `src/generated/skill.ts`, which ships in the bundle. Everything else gets the full procedure.
- Scope step 2 to functions whose signature, return value, or behavior changed. Renamed or moved-only code needs only a reference sweep.
- This is a single-package repo, so step 4 is always the whole suite — it is cheap. Do not skip legs selectively; the only scoping is the build/smoke leg, which applies only when the diff touches `build.ts`, `codegen/`, `skill/SKILL.md`, or packaging.
- Bound step 7 to settling a specific uncertain claim or reproducing a suspected failure, not a default sweep.

## Verdict contract

The auto-approve workflow (`.github/workflows/auto-approve-claude-lgtm.yml`) approves the PR when your review body starts with "LGTM". Follow this contract exactly:

- When you find no blocking (Important-severity) issues, the review summary MUST begin with the exact token `LGTM:` followed by a one-line rationale.
- When blocking issues exist, the string "LGTM" must not appear anywhere in the review body. Do not write phrases like "not LGTM yet" or "almost LGTM".

## Severity

Nits alone are not blocking. If everything you found is Nit-level, the verdict is still `LGTM:` and the nits follow after the summary line.
