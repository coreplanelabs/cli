import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { formatOutput } from '../../output/formatter';
import { getArgString, promptIfMissing } from '../helpers';
import { promptPassword, intro, outro, note } from '../../utils/prompt';
import { writeCredentials } from '../../auth/credentials';
import { parseSessionExpiresAt } from '../../auth/signup-helpers';
import type { OAuthCredential } from '../../auth/types';
import { request } from '../../client/http';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import type { User } from '../../generated/types';

interface SignupBody {
  email: string;
  password: string;
}

interface SignupEnvelope {
  success: boolean;
  result: { user: User; token?: string };
  error: { message?: string; detail?: string } | null;
}

export const authSignupCommand: Command = {
  name: 'auth signup',
  description: 'Bootstrap a new Nominal account with email + password',
  operationId: 'auth.signup',
  options: [
    { flag: '--email <email>', description: 'Email address', type: 'string' },
    { flag: '--password <password>', description: 'Password (prompted if omitted)', type: 'string' },
  ],
  examples: [
    'nominal auth signup --email agent@example.com --password "$PW"',
    'nominal auth signup --email agent@example.com   # prompts for password',
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    intro('Create a Nominal account');
    const email = await promptIfMissing(config, args, 'email', 'Email', '--email');
    const password =
      getArgString(args, 'password') ??
      (await promptPassword({ nonInteractive: config.nonInteractive }, 'Password'));

    // Need response headers (Set-Cookie -> session expiry) so call request() directly
    // rather than via the generated client which only exposes the body.
    // Note: signup is idempotent for an existing user with a matching password —
    // it returns a fresh session token. Agents can re-invoke `auth signup` with
    // the same credentials to renew, or (better) create an API key after first
    // signup and switch to it.
    const body: SignupBody = { email, password };
    const res = await request(config, { method: 'POST', url: '/v1/auth/signup', body, noAuth: true });
    const json = (await res.json()) as SignupEnvelope;
    if (!res.ok || !json.success) {
      throw new CLIError(json.error?.detail ?? json.error?.message ?? 'Signup failed', ExitCode.GENERAL);
    }
    const result = json.result;
    const expiresAt =
      parseSessionExpiresAt(res.headers.get('set-cookie')) ??
      // Server didn't include Expires (shouldn't happen, but stay safe): treat as
      // an immediate-expiry token so the next request triggers re-auth.
      new Date().toISOString();

    if (result.token) {
      const cred: OAuthCredential = {
        type: 'oauth',
        accessToken: result.token,
        refreshToken: '',
        expiresAt,
        tokenType: 'Bearer',
        scope: '',
        account: result.user.email ?? result.user.id,
      };
      writeCredentials(cred);
    }

    formatOutput(config, result);

    if (result.token) {
      note(
        [
          `You are signed in. The session is valid until ${expiresAt}.`,
          ``,
          `Onboarding (in order):`,
          ``,
          `  1. Create a workspace`,
          `     nominal workspace create --name "My Workspace"`,
          ``,
          `  2. Browse what you can connect`,
          `     nominal integration catalog`,
          ``,
          `  3. Connect an integration`,
          `     nominal integration connect --type <type>    # see --help`,
          ``,
          `  4. Connect a cloud account`,
          `     nominal cloud connect --provider <provider>  # see --help`,
          ``,
          `  5. Add an automation from the catalog`,
          `     nominal automation catalog`,
          `     nominal automation from-template <slug>`,
          ``,
          `  6. Verify what's wired up`,
          `     nominal integration list`,
          `     nominal cloud list`,
          `     nominal service list`,
          `     nominal automation list`,
          ``,
          `Once things are connected, try:`,
          `  nominal thread ask "summarise production"`,
        ].join('\n'),
        'Next steps'
      );
      outro('Signed in.');
    } else {
      outro('Signup accepted but no session returned. Run `nominal auth login` to authenticate.');
    }
  },
};
