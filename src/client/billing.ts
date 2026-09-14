import type { Config } from '../config/schema';
import { requestJson } from './http';
import type { BillingCycle, PlanCatalog, WorkspacePlan } from '../billing/plans';

// Hand-written rather than generated: these routes reach the public OpenAPI
// document with the API release that adds return URLs, and the client is
// generated from the live spec at build time. Fold into the generated client
// once that release is out.

export interface CheckoutRequest {
  workspaceId: string;
  plan: string;
  billingCycle: BillingCycle;
  // Loopback URLs Stripe returns to; both or neither. Without them the
  // browser ends on the console billing page.
  successUrl?: string;
  cancelUrl?: string;
}

export function fetchPlanCatalog(config: Config): Promise<PlanCatalog> {
  return requestJson<PlanCatalog>(config, { method: 'GET', url: '/v1/public/billing/plans', noAuth: true });
}

export function fetchWorkspacePlan(config: Config, workspaceId: string): Promise<WorkspacePlan> {
  return requestJson<WorkspacePlan>(config, {
    method: 'GET',
    url: `/v1/workspaces/plan/${encodeURIComponent(workspaceId)}`,
  });
}

export function createCheckoutSession(config: Config, body: CheckoutRequest): Promise<{ url: string }> {
  return requestJson<{ url: string }>(config, { method: 'POST', url: '/v1/billing/checkout', body });
}

export function createPortalSession(config: Config, workspaceId: string): Promise<{ url: string }> {
  return requestJson<{ url: string }>(config, { method: 'POST', url: '/v1/billing/portal', body: { workspaceId } });
}

export interface Subscription {
  plan: string;
  status: string;
  billingCycle: BillingCycle;
  stripeSubscriptionId: string | null;
}

export function fetchSubscription(config: Config, workspaceId: string): Promise<Subscription> {
  return requestJson<Subscription>(config, {
    method: 'GET',
    url: `/v1/billing/subscriptions/${encodeURIComponent(workspaceId)}`,
  });
}

export interface ChangePlanRequest {
  workspaceId: string;
  newPlan: string;
  newBillingCycle: BillingCycle;
}

// In-place, prorated change of an existing Stripe subscription. Stripe is
// updated synchronously; the workspace plan follows when the webhook lands.
export function changePlan(config: Config, body: ChangePlanRequest): Promise<{ plan: string; billingCycle: BillingCycle }> {
  return requestJson<{ plan: string; billingCycle: BillingCycle }>(config, { method: 'POST', url: '/v1/billing/change-plan', body });
}
