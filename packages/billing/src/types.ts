/**
 * Billing types for Stripe metered integration
 */

export type BillingMetric =
  | 'traces_recorded'
  | 'agents_tracked'
  | 'webhooks_delivered'
  | 'storage_gb';

export interface UsageReport {
  customerId: string;
  from: number;
  to: number;
  tracesRecorded: number;
  agentsTracked: number;
  webhooksDelivered: number;
  storageGb: number;
}

export interface CreateCustomerOptions {
  email: string;
  metadata?: Record<string, string>;
}

export interface CreateCheckoutSessionOptions {
  customerId: string;
  priceId?: string;
  successUrl?: string;
  cancelUrl?: string;
}
