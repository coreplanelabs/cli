import type { Config } from '../config/schema';
import { createCheckoutSession, fetchWorkspacePlan, type CheckoutRequest } from '../client/billing';
import { canWaitForBrowser, scopedSigint } from '../commands/helpers';
import { isApiError } from '../errors/api';
import { CLIError } from '../errors/base';
import { Spinner } from '../output/progress';
import { openBrowser } from '../utils/browser';
import { isInteractive, isRemoteTerminal } from '../utils/env';
import type { BillingCycle, CatalogPlan, WorkspacePlan } from './plans';
import { startReturnListener, type ReturnListener, type ReturnOutcome } from './return-listener';

// The one line every non-upgrade exit ends with, so nobody is left thinking
// the door closed.
export const UPGRADE_LATER = 'Upgrade any time: polylane subscription upgrade';

// upgraded: the workspace is on the new plan.
// canceled: the customer backed out of Stripe (explicit, via the cancel URL).
// timeout:  nothing came back in time; treated as "not now".
// pending:  Stripe reported success but the plan has not flipped yet (webhook lag).
// handoff:  the URL was printed and nothing was waited for (json output or no TTY).
export type CheckoutOutcome = 'upgraded' | 'canceled' | 'timeout' | 'pending' | 'handoff';

export interface CheckoutOptions {
  workspaceId: string;
  plan: CatalogPlan;
  cycle: BillingCycle;
  noBrowser: boolean;
  // The plan id before checkout; a different id on the plan endpoint is the
  // upgrade landing, whichever route the news arrives by.
  previousPlanId: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  // After the browser reports success, how long to wait for the plan flip.
  settleMs?: number;
}

export interface CheckoutDeps {
  startListener: () => Promise<ReturnListener | null>;
  openBrowser: (url: string) => void;
  fetchPlan: (config: Config, workspaceId: string) => Promise<WorkspacePlan>;
  createCheckout: (config: Config, body: CheckoutRequest) => Promise<{ url: string }>;
  sleep: (ms: number) => Promise<void>;
  // Whether this terminal can wait for the browser at all (a TTY, not json).
  canWait: (config: Config) => boolean;
  // stdout is data (the URL); injectable so tests never stub the process stream
  // the test runner itself reports through.
  writeOut: (line: string) => void;
}

const defaultDeps: CheckoutDeps = {
  startListener: () => startReturnListener(),
  openBrowser,
  fetchPlan: fetchWorkspacePlan,
  createCheckout: createCheckoutSession,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  canWait: canWaitForBrowser,
  writeOut: (line) => {
    process.stdout.write(line);
  },
};

const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_POLL_MS = 3_000;
const DEFAULT_SETTLE_MS = 90_000;

export const TERMS_LINE = 'Paying accepts the terms: https://polylane.com/terms';

// Only an https URL is ever handed to the OS opener. The API is trusted, but
// --domain lets a user point the CLI anywhere, and `open file:///…` or a
// custom scheme must never be one bad response away.
export function isOpenableUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

function printCheckoutUrl(config: Config, url: string, noBrowser: boolean, deps: CheckoutDeps): void {
  const shouldOpen = !noBrowser && isInteractive(config.nonInteractive) && isOpenableUrl(url);
  if (!config.quiet) {
    process.stderr.write(`${TERMS_LINE}\n`);
    process.stderr.write(
      shouldOpen ? "Opening checkout in your browser…\nIf it doesn't open, use this URL:\n" : 'Open this URL to upgrade:\n'
    );
  }
  deps.writeOut(url + '\n');
  if (shouldOpen) deps.openBrowser(url);
}

// Opens Stripe Checkout for `plan` and waits for the outcome. Two signals
// race: the browser returning to the local listener (immediate, and the only
// way to know about a cancel) and the plan endpoint flipping (the webhook
// landed; also the fallback when no listener could bind or the API ignored
// the return URLs). Ctrl+C stops waiting and counts as "not now".
export async function runCheckout(config: Config, opts: CheckoutOptions, deps: CheckoutDeps = defaultDeps): Promise<CheckoutOutcome> {
  const waits = deps.canWait(config);
  // The loopback listener only helps when the browser runs on this machine.
  // --no-browser says it does not, and an SSH session means it cannot; in
  // both cases Stripe returns to the console page and the plan poll below
  // is the only signal.
  const browserIsHere = !opts.noBrowser && !isRemoteTerminal();
  const listener = waits && browserIsHere ? await deps.startListener() : null;
  // Registered before the checkout request so a return that lands during it
  // is already visible when the wait starts.
  let returned: ReturnOutcome | null = null;
  void listener?.outcome.then((o) => {
    returned = o;
  });
  const body: CheckoutRequest = {
    workspaceId: opts.workspaceId,
    plan: opts.plan.id,
    billingCycle: opts.cycle,
    ...(listener ? { successUrl: listener.successUrl, cancelUrl: listener.cancelUrl } : {}),
  };
  let url: string;
  try {
    ({ url } = await deps.createCheckout(config, body));
  } catch (err) {
    listener?.close();
    if (isApiError(err)) {
      throw new CLIError(`Couldn't start checkout: ${err.message}`, err.exitCode, [err.hint, UPGRADE_LATER].filter(Boolean).join('\n'));
    }
    throw err;
  }
  if (config.output === 'json') {
    listener?.close();
    deps.writeOut(JSON.stringify({ url }, null, 2) + '\n');
    return 'handoff';
  }
  printCheckoutUrl(config, url, opts.noBrowser, deps);
  if (!waits) return 'handoff';

  const planFlipped = async (): Promise<boolean> => {
    try {
      const plan = await deps.fetchPlan(config, opts.workspaceId);
      return plan.plan.id !== opts.previousPlanId;
    } catch {
      return false;
    }
  };

  const spinner = new Spinner('Waiting for checkout… (Ctrl+C to stop waiting)');
  let interrupted = false;
  const restoreSigint = scopedSigint(() => {
    interrupted = true;
  });
  if (!config.quiet) process.stderr.write('\nFinish in the browser, then come back to this terminal.\n');
  spinner.start();
  try {
    const poll = opts.pollIntervalMs ?? DEFAULT_POLL_MS;
    const deadline = Date.now() + (opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    // Check before the first sleep so an instant cancel is not held for a poll interval.
    for (let first = true; Date.now() < deadline && !interrupted; first = false) {
      if (!first) await deps.sleep(poll);
      if (interrupted) break;
      if (returned === 'cancel') return 'canceled';
      if (await planFlipped()) return 'upgraded';
      if (returned === 'success') {
        spinner.update('Payment received, updating your plan…');
        const settleBy = Date.now() + (opts.settleMs ?? DEFAULT_SETTLE_MS);
        while (Date.now() < settleBy && !interrupted) {
          await deps.sleep(poll);
          if (await planFlipped()) return 'upgraded';
        }
        return 'pending';
      }
    }
    return 'timeout';
  } finally {
    spinner.stop(interrupted ? 'Stopped waiting. Finish in the browser any time; your plan updates on its own.' : undefined);
    restoreSigint();
    listener?.close();
  }
}
