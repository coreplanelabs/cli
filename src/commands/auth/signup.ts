import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { formatOutput } from '../../output/formatter';
import { getArgString, promptIfMissing } from '../helpers';
import { promptEnter, promptPassword, promptSelect, promptText, intro, outro, note } from '../../utils/prompt';
import { isInteractive } from '../../utils/env';
import { oauthLogin, selectWorkspace, type WhoamiResult } from './login';
import { writeCredentials } from '../../auth/credentials';
import { resolveOnboardingRunId, consumeOnboardingRunFile } from '../../auth/onboarding-run';
import { parseSessionExpiresAt } from '../../auth/signup-helpers';
import { readInstallRef } from '../../telemetry/environment';
import type { OAuthCredential } from '../../auth/types';
import { writeConfigFile } from '../../config/loader';
import { request, requestJson } from '../../client/http';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import type { User } from '../../generated/types';

type SignupMethod = 'google' | 'github' | 'email';

interface ApiErrorBody {
  message?: string;
  detail?: string;
}

interface SignupEnvelope {
  success: boolean;
  result: { user: User; token?: string };
  error: ApiErrorBody | null;
}

export interface Landing {
  kind:
    | 'existing'
    | 'created'
    | 'joined'
    | 'verify_email'
    | 'verify_to_join'
    | 'workspace_full'
    | 'invite_at_capacity'
    | 'none';
  workspaceSlug?: string;
  workspace?: { id: string; name: string };
}

interface VerifyEmailEnvelope {
  success: boolean;
  result: { token?: string; landing?: Landing };
  error: ApiErrorBody | null;
}

interface VerifiedSession {
  token?: string;
  landing?: Landing;
  expiresAt: string;
}

const CODE_ATTEMPTS = 3;

const OAUTH_PROVIDER_LABELS: Record<'google' | 'github', string> = {
  google: 'Google',
  github: 'GitHub',
};

// Verbs stay separate on purpose: users agree to the Terms by contract but
// only acknowledge the Privacy Policy — never "agree to our Terms and
// Privacy Policy".
const TERMS_NOTICE = [
  'By continuing, you agree to the Terms of Service and acknowledge the Privacy Policy:',
  '  https://polylane.com/terms/',
  '  https://polylane.com/privacy/',
].join('\n');

function writeSessionCredential(token: string, expiresAt: string, account: string): void {
  const cred: OAuthCredential = {
    type: 'oauth',
    accessToken: token,
    refreshToken: '',
    expiresAt,
    tokenType: 'Bearer',
    scope: '',
    account,
  };
  writeCredentials(cred);
}

function workspaceStep(landing?: Landing): string[] {
  const setDefault = [`     polylane workspace list`, `     polylane workspace use <id>`];
  switch (landing?.kind) {
    case 'created':
      return [
        landing.workspaceSlug
          ? `  1. Your first workspace ("${landing.workspaceSlug}") was created: set it as the default`
          : `  1. Your first workspace was created: set it as the default`,
        ...setDefault,
      ];
    case 'joined':
      return [
        landing.workspaceSlug
          ? `  1. You joined the "${landing.workspaceSlug}" workspace: set it as the default`
          : `  1. You joined an existing workspace: set it as the default`,
        ...setDefault,
      ];
    case 'existing':
      return [`  1. Set your default workspace`, ...setDefault];
    default:
      return [`  1. Create a workspace`, `     polylane workspace create --name "My Workspace"`];
  }
}

export function nextSteps(landing?: Landing): string {
  return [
    `Onboarding (in order):`,
    ``,
    ...workspaceStep(landing),
    ``,
    `  2. Browse what you can connect`,
    `     polylane integration catalog`,
    ``,
    `  3. Connect an integration`,
    `     polylane integration connect --type <type>    # see --help`,
    ``,
    `  4. Connect a cloud account`,
    `     polylane cloud connect --provider <provider>  # see --help`,
    ``,
    `  5. Add an automation from the catalog`,
    `     polylane automation catalog`,
    `     polylane automation from-template <slug>`,
    ``,
    `  6. Verify what's wired up`,
    `     polylane integration list`,
    `     polylane cloud list`,
    `     polylane service list`,
    `     polylane automation list`,
    ``,
    `Once things are connected, try:`,
    `  polylane thread ask "summarise production"`,
  ].join('\n');
}

// One browser trip does both signup and CLI login: the browser lands on the
// console signup page with ?redirect= pointing at the CLI's OAuth consent URL.
// The console keeps that redirect alive across the provider round-trip, so
// after the account is created the user falls straight onto the consent
// screen, and the loopback redirect hands the CLI a full token pair
// (access + refresh) — same as `auth login`.
async function oauthSignup(config: Config, provider: 'google' | 'github'): Promise<void> {
  const label = OAUTH_PROVIDER_LABELS[provider];
  note(
    [
      `Your browser will open the Polylane signup page.`,
      `Pick "${label}" there, then approve the CLI's access when asked.`,
      ``,
      TERMS_NOTICE,
    ].join('\n'),
    `Sign up with ${label}`
  );
  await promptEnter({ nonInteractive: config.nonInteractive }, 'Create your account?');
  await oauthLogin(config, true, { signupEntry: true, provider });
}

// Returns null when the server rejects the code (invalid or expired) so the
// caller can re-prompt; any other failure throws.
async function verifyEmail(config: Config, email: string, code: string): Promise<VerifiedSession | null> {
  const res = await request(config, {
    method: 'POST',
    url: '/v1/auth/verify_email',
    body: { email, code },
    noAuth: true,
  });
  const json = (await res.json()) as VerifyEmailEnvelope;
  if (res.status === 400) return null;
  if (!res.ok || !json.success) {
    throw new CLIError(json.error?.detail ?? json.error?.message ?? 'Email verification did not complete', ExitCode.GENERAL);
  }
  const expiresAt =
    parseSessionExpiresAt(res.headers.get('set-cookie')) ??
    // Server didn't include Expires (shouldn't happen, but stay safe): treat as
    // an immediate-expiry token so the next request triggers re-auth.
    new Date().toISOString();
  return { ...json.result, expiresAt };
}

async function persistDefaultWorkspace(config: Config): Promise<void> {
  try {
    const user = await requestJson<WhoamiResult>(config, {
      method: 'GET',
      url: '/v1/auth/whoami',
    });
    const wsId = await selectWorkspace(config, user);
    if (wsId) {
      writeConfigFile({ workspace_id: wsId });
    }
  } catch {
    // non-fatal
  }
}

// Raw envelopes (user object, session token, landing) are output only in
// JSON mode, where they are the data contract for scripts. In a terminal
// the token already lives in credentials.json and the tables are noise.
function emitResult(config: Config, data: unknown): void {
  if (config.output === 'json') formatOutput(config, data);
}

async function finishEmailSignIn(config: Config, email: string, session: VerifiedSession): Promise<void> {
  if (!session.token) {
    emitResult(config, { landing: session.landing });
    outro('Email verified, but no session was returned. Run `polylane auth login`.');
    return;
  }
  writeSessionCredential(session.token, session.expiresAt, email);
  await persistDefaultWorkspace(config);
  emitResult(config, { token: session.token, landing: session.landing });
  if (config.hints) note(nextSteps(session.landing), 'Next steps');
  outro(`Signed in as ${email}.`);
}

// Also the CLI's email sign-in path: signup is idempotent for an existing
// user with a matching password, so `auth login`'s Email option routes here.
export async function emailSignup(config: Config, args: Record<string, unknown>): Promise<void> {
  const email = await promptIfMissing(config, args, 'email', 'Email', '--email');

  // `--code` completes a signup that already received its verification email.
  const codeArg = getArgString(args, 'code');
  if (codeArg) {
    const session = await verifyEmail(config, email, codeArg.trim());
    if (!session) {
      throw new CLIError(
        'Invalid or expired verification code',
        ExitCode.GENERAL,
        'Codes expire after 15 minutes. Re-run `polylane auth signup` to get a new one.'
      );
    }
    await finishEmailSignIn(config, email, session);
    return;
  }

  const passwordArg = getArgString(args, 'password');
  const password =
    passwordArg ?? (await promptPassword({ nonInteractive: config.nonInteractive }, 'Password'));

  // The terms notice rides the one account-creating POST below; emailSignup and
  // oauthSignup are mutually exclusive per run, so it shows at most once. The
  // gate wording is neutral because this is also `auth login`'s Email route and
  // signup is idempotent for an existing account. A --password invocation is
  // scripted consent: print the notice, never block on Enter.
  if (passwordArg === undefined && isInteractive(config.nonInteractive)) {
    note(TERMS_NOTICE);
    await promptEnter({ nonInteractive: config.nonInteractive }, 'Continue?');
  } else {
    process.stderr.write(`\n${TERMS_NOTICE}\n\n`);
  }

  // Need response headers (Set-Cookie -> session expiry) so call request() directly
  // rather than via the generated client which only exposes the body.
  // Note: signup is idempotent for an existing user with a matching password —
  // it returns a fresh session token. Agents can re-invoke `auth signup` with
  // the same credentials to renew, or (better) create an API key after first
  // signup and switch to it.
  // Attribution ride-alongs: the install referral slug (~/.polylane/ref) and
  // the pre-auth onboarding run identifier. The server drops invalid values
  // and never rejects on them.
  const ref = readInstallRef();
  const run = resolveOnboardingRunId();
  const res = await request(config, {
    method: 'POST',
    url: '/v1/auth/signup',
    body: { email, password, ...(ref ? { ref } : {}), ...(run ? { run } : {}) },
    noAuth: true,
  });
  const json = (await res.json()) as SignupEnvelope;
  if (!res.ok || !json.success) {
    throw new CLIError(json.error?.detail ?? json.error?.message ?? 'Signup did not complete', ExitCode.GENERAL);
  }
  // The run id (if any) rode this signup request and the server has bound it —
  // on both the created and existing-account paths. Consume the one-shot file so
  // it can't re-stamp future signups on this machine. Never under --dry-run: the
  // request was stubbed (no bind happened), so deleting the file would spend the
  // one-shot run id without ever carrying it to the server.
  if (!config.dryRun) consumeOnboardingRunFile();
  const { user, token } = json.result;
  if (!user) {
    // dry-run stub or unexpected server response
    emitResult(config, json.result);
    outro('Account created, but no session returned. Run `polylane auth login`.');
    return;
  }

  if (user.emailVerified) {
    // Existing account re-authenticated: the session works immediately.
    if (!token) {
      emitResult(config, json.result);
      outro('Account created, but no session returned. Run `polylane auth login`.');
      return;
    }
    const expiresAt = parseSessionExpiresAt(res.headers.get('set-cookie')) ?? new Date().toISOString();
    writeSessionCredential(token, expiresAt, user.email ?? user.id);
    await persistDefaultWorkspace(config);
    emitResult(config, json.result);
    if (config.hints) note(nextSteps(), 'Next steps');
    outro(`Signed in as ${user.email ?? user.id}.`);
    return;
  }

  // Unverified accounts get a 401 on every authenticated route, so the token
  // from signup is unusable until the emailed 6-digit code is entered.
  // Signup only emails a code when it creates the account; an older unverified
  // account re-running signup has no fresh code in flight, so request one.
  const createdMs = user.created ? new Date(user.created).getTime() : NaN;
  const justCreated = Number.isFinite(createdMs) && Date.now() - createdMs < 2 * 60 * 1000;
  if (!justCreated) {
    await request(config, {
      method: 'POST',
      url: '/v1/auth/resend_verification_code',
      body: { id: user.id },
      noAuth: true,
    }).catch(() => undefined);
  }

  if (!isInteractive(config.nonInteractive)) {
    emitResult(config, json.result);
    outro(
      `Check ${email} for a verification code, then run: polylane auth signup --email ${email} --code <code>`
    );
    return;
  }

  for (let attempt = 1; attempt <= CODE_ATTEMPTS; attempt++) {
    const code = await promptText(
      { nonInteractive: config.nonInteractive },
      `Enter the 6-digit code sent to ${email}`,
      {
        placeholder: '000000',
        validate: (v) => (/^\s*\d{6}\s*$/.test(v) ? undefined : 'The code is 6 digits'),
      }
    );
    const session = await verifyEmail(config, email, code.trim());
    if (session) {
      await finishEmailSignIn(config, email, session);
      return;
    }
    if (attempt < CODE_ATTEMPTS) {
      process.stderr.write('Invalid or expired code. Try again.\n');
    }
  }
  throw new CLIError(
    'Email verification did not complete',
    ExitCode.GENERAL,
    `Re-run \`polylane auth signup\` for a fresh code, or finish later with: polylane auth signup --email ${email} --code <code>`
  );
}

export const authSignupCommand: Command = {
  name: 'auth signup',
  description: 'Create a Polylane account with Google, GitHub, or email',
  operationId: 'auth.signup',
  options: [
    { flag: '--email <email>', description: 'Email address (implies email signup)', type: 'string' },
    { flag: '--password <password>', description: 'Password (prompted if omitted)', type: 'string' },
    {
      flag: '--code <code>',
      description: 'Verification code from the signup email (completes email signup)',
      type: 'string',
    },
  ],
  examples: [
    'polylane auth signup',
    'polylane auth signup --email agent@example.com --password "$PW"',
    'polylane auth signup --email agent@example.com --code 123456   # finish verification',
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    intro('Create a Polylane account');

    const hasEmailFlags =
      getArgString(args, 'email') !== undefined ||
      getArgString(args, 'password') !== undefined ||
      getArgString(args, 'code') !== undefined;

    let method: SignupMethod = 'email';
    if (!hasEmailFlags && isInteractive(config.nonInteractive)) {
      method = await promptSelect<SignupMethod>(
        { nonInteractive: config.nonInteractive },
        'Sign up with',
        [
          { value: 'google', label: 'Google', hint: 'opens your browser' },
          { value: 'github', label: 'GitHub', hint: 'opens your browser' },
          { value: 'email', label: 'Email and password' },
        ]
      );
    }

    if (method === 'email') {
      await emailSignup(config, args);
      return;
    }
    await oauthSignup(config, method);
  },
};
