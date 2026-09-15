import { createServer, type Server } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { ALERT_ICON, CHECK_ICON, renderBrowserPage } from '../utils/browser-page';

// Where Stripe sends the browser after checkout. The listener binds an
// ephemeral port on the loopback interface (never 18991 — that is sign-in's),
// so two flows can run at once and nothing on the LAN can reach it. Each URL
// carries a one-time state token; a request without the right token is
// answered 404 and ignored, so a stray local request can never be mistaken
// for the customer coming back.
export type ReturnOutcome = 'success' | 'cancel';

export interface ReturnListener {
  successUrl: string;
  cancelUrl: string;
  // Resolves once, with the first valid return. Never rejects.
  outcome: Promise<ReturnOutcome>;
  close(): void;
}

const SUCCESS_PATH = '/billing/return';
const CANCEL_PATH = '/billing/cancel';

function renderReturnPage(outcome: ReturnOutcome): string {
  if (outcome === 'success') {
    return renderBrowserPage(
      'Upgraded',
      '#10b981',
      'Your plan is upgraded',
      'You can close this tab and return to your terminal.',
      CHECK_ICON
    );
  }
  return renderBrowserPage(
    'Checkout canceled',
    '#f59e0b',
    'Checkout canceled',
    'Nothing was charged. You can close this tab and return to your terminal.',
    ALERT_ICON
  );
}

function sameToken(candidate: string | null, expected: string): boolean {
  if (candidate === null) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Resolves null when no port can be bound; callers then fall back to polling
// the plan, so a busy machine degrades to a slower wait, not a failure.
export function startReturnListener(host = '127.0.0.1'): Promise<ReturnListener | null> {
  const state = randomBytes(16).toString('hex');
  return new Promise((resolveListener) => {
    let settle: ((outcome: ReturnOutcome) => void) | null = null;
    const outcome = new Promise<ReturnOutcome>((r) => {
      settle = r;
    });
    let server: Server | null = null;
    server = createServer((req, res) => {
      const url = new URL(req.url || '/', `http://${host}`);
      const path = url.pathname;
      const wanted = path === SUCCESS_PATH ? 'success' : path === CANCEL_PATH ? 'cancel' : null;
      if (!wanted || !sameToken(url.searchParams.get('state'), state)) {
        res.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(renderReturnPage(wanted));
      settle?.(wanted);
      settle = null;
    });
    server.once('error', () => {
      server = null;
      resolveListener(null);
    });
    server.listen(0, host, () => {
      const address = server?.address();
      if (!address || typeof address === 'string') {
        server?.close();
        resolveListener(null);
        return;
      }
      const hostname = address.family === 'IPv6' ? `[${address.address}]` : address.address;
      const base = `http://${hostname}:${address.port}`;
      // Nothing may keep the process alive once the command is done.
      server?.unref();
      resolveListener({
        successUrl: `${base}${SUCCESS_PATH}?state=${state}`,
        cancelUrl: `${base}${CANCEL_PATH}?state=${state}`,
        outcome,
        close: () => {
          server?.close();
          server = null;
        },
      });
    });
  });
}
