/**
 * AgentTrace Billing
 * Stripe metered billing integration for hosted version
 */

export const VERSION = '0.1.0';
export const PACKAGE_NAME = '@agenttrace-io/billing';

export type { BillingMetric, UsageReport, CreateCustomerOptions } from './types.js';
export {
  createCustomer,
  createSubscription,
  recordUsage,
  getUsage,
  createCheckoutSession,
  StripeBillingClient,
} from './stripe.js';
