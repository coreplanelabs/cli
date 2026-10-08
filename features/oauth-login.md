# OAuth login

## User outcome

A user signs in, approves the registered CLI permissions, and receives an OAuth
grant. Google sign-in carries the same consent request through the provider
redirect. Retired scopes are absent from both browser and device requests.

## Entry points and prerequisites

`polylane auth login` uses browser consent. `polylane auth login --no-browser`
uses device authorization. The interactive login offers Google sign-in.
Use a released binary with its registered OAuth client, or a local build with
`POLYLANE_OAUTH_CLIENT_ID` and `POLYLANE_OAUTH_CLIENT_SECRET` from the target
environment's secret store. The user needs a verified account and workspace
membership. Use a test account and a separate operating-system user for manual
checks: the CLI stores credentials under that user's `~/.polylane` directory.

## Local checks

From the CLI repository, run `npm ci`, `npm run typecheck`, `npm run lint`,
`npm run test`, and `npm run build`. Typecheck regenerates the live API types.
The default scope list must satisfy `OAuthClient.scopes`; a retired scope
must cause a type error.

`test/onboarding-run.test.ts` checks the Google redirect without a browser or
network request. It requires that the nested consent URL omit all three
`datasets:*` scopes. `test/oauth-client.test.ts` preserves the issue, agent
tool, and page permissions. The type error and Google regression both fail
when the retired dataset scopes are restored.

## Manual sign-in

Check `polylane --version` and `polylane auth status` before using the released
build. Start browser login under the test operating-system user, select Google, finish
sign-in, and approve consent. Expect the CLI to finish sign-in without
`Invalid scopes requested`. Confirm `polylane auth status` and
`polylane workspace list`. Repeat with `--no-browser` to check device consent.
Confirm the grant's scopes stay within the registered client allowlist.

Use an account you own. Keep credentials out of proof logs and run
`polylane auth logout` after the check. This attempts access-token revocation
and removes local credentials; it does not revoke the refresh token.

## Boundaries and proof status

The server rejects a scope outside the registered client allowlist. Keep that
refusal; removing a product permission does not permit restoring it for login.
The offline checks prove request construction and the generated API contract.
They do not prove Google acceptance, the token exchange, or a customer login.
Live browser and device sign-in on a released build remain a manual check.
Record the tested revision, build, environment, result, and sanitized evidence
in the pull request before claiming that user outcome passed.

## Source anchors

- `src/auth/oauth.ts`: requested scopes, browser URLs, and device requests.
- `src/commands/auth/login.ts`: login entry point and coordination.
- `src/auth/credentials.ts`: credential persistence.
- `src/generated/types.ts`: generated OAuth client scope contract.
