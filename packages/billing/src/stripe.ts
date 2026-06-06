/**
 * Stripe integration for metered billing.
 *
 * Environment variables:
 *   STRIPE_SECRET_KEY     - required for all API calls
 *   STRIPE_PRICE_ID       - default price for subscriptions / metered items
 *   STRIPE_WEBHOOK_SECRET - for verifying incoming webhooks (consumers)
 *
 * Metrics supported:
 *   traces_recorded     - increment per trace recorded (primary)
 *   agents_tracked      - per active agent per day
 *   webhooks_delivered  - per 100 webhooks (billed in batches)
 *   storage_gb          - per GB stored per month
 */

import Stripe from 'stripe';
import type { BillingMetric, UsageReport } from './types.js';

let _stripe: Stripe | null = null;

function getStripeClient(): Stripe {
  if (_stripe) return _stripe;
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY environment variable is required');
  }
  _stripe = new Stripe(secretKey, {
    // Use a recent stable API version (update as needed)
    apiVersion: '2025-02-24.acacia',
    typescript: true,
  });
  return _stripe;
}

function getDefaultPriceId(): string {
  const pid = process.env.STRIPE_PRICE_ID;
  if (!pid) {
    throw new Error(
      'STRIPE_PRICE_ID environment variable is required (or pass priceId explicitly)',
    );
  }
  return pid;
}

/**
 * Resolve a price id for a given metric.
 * Supports optional per-metric price env vars for advanced setups:
 *   STRIPE_PRICE_TRACES_RECORDED, STRIPE_PRICE_AGENTS_TRACKED, etc.
 * Falls back to STRIPE_PRICE_ID.
 */
function getPriceIdForMetric(metric: BillingMetric): string {
  const envKeyMap: Record<BillingMetric, string> = {
    traces_recorded: 'STRIPE_PRICE_TRACES_RECORDED',
    agents_tracked: 'STRIPE_PRICE_AGENTS_TRACKED',
    webhooks_delivered: 'STRIPE_PRICE_WEBHOOKS_DELIVERED',
    storage_gb: 'STRIPE_PRICE_STORAGE_GB',
  };
  const specific = process.env[envKeyMap[metric]];
  if (specific) return specific;
  return getDefaultPriceId();
}

/**
 * Find the subscription item id that matches a given price id (or first active item).
 */
async function findSubscriptionItemId(
  stripe: Stripe,
  customerId: string,
  targetPriceId?: string,
): Promise<string> {
  const subs = await stripe.subscriptions.list({
    customer: customerId,
    status: 'active',
    limit: 5,
    expand: ['data.items.data.price'],
  });
  if (subs.data.length === 0) {
    throw new Error(`No active subscription found for customer ${customerId}`);
  }
  // Prefer the first active sub
  const sub = subs.data[0]!;
  if (!sub.items?.data?.length) {
    throw new Error(`Subscription ${sub.id} has no items`);
  }
  if (targetPriceId) {
    const match = sub.items.data.find((item) => {
      const price = typeof item.price === 'string' ? item.price : item.price?.id;
      return price === targetPriceId;
    });
    if (match) return match.id;
  }
  // fallback to first item (common for single metered price subs)
  return sub.items.data[0]!.id;
}

export async function createCustomer(
  email: string,
  metadata: Record<string, string> = {},
): Promise<string> {
  const stripe = getStripeClient();
  const customer = await stripe.customers.create({
    email,
    metadata,
  });
  return customer.id;
}

export async function createSubscription(customerId: string, priceId?: string): Promise<string> {
  const stripe = getStripeClient();
  const pid = priceId || getDefaultPriceId();
  const subscription = await stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: pid }],
    // For metered prices, do not pass quantity here; report via usage records
    expand: ['items.data.price'],
  });
  return subscription.id;
}

export async function recordUsage(
  customerId: string,
  metric: BillingMetric,
  quantity: number,
): Promise<void> {
  if (quantity <= 0) return; // nothing to report
  const stripe = getStripeClient();
  const priceId = getPriceIdForMetric(metric);
  const subscriptionItemId = await findSubscriptionItemId(stripe, customerId, priceId);

  await stripe.subscriptionItems.createUsageRecord(subscriptionItemId, {
    quantity: Math.floor(quantity),
    timestamp: Math.floor(Date.now() / 1000),
    action: 'increment',
  });
}

export async function getUsage(
  customerId: string,
  fromDate: number,
  toDate: number,
): Promise<UsageReport> {
  const stripe = getStripeClient();

  // Find active sub + items
  const subs = await stripe.subscriptions.list({
    customer: customerId,
    status: 'active',
    limit: 1,
    expand: ['data.items.data.price'],
  });

  const report: UsageReport = {
    customerId,
    from: fromDate,
    to: toDate,
    tracesRecorded: 0,
    agentsTracked: 0,
    webhooksDelivered: 0,
    storageGb: 0,
  };

  if (subs.data.length === 0) {
    return report;
  }

  const sub = subs.data[0]!;
  if (!sub.items?.data?.length) {
    return report;
  }

  // For each item, pull the usage record summary for the current billing period.
  // Note: listUsageRecordSummaries reflects the subscription's current period.
  // The from/to params are stored in the report for caller context.
  for (const item of sub.items.data) {
    try {
      const summaries = await stripe.subscriptionItems.listUsageRecordSummaries(item.id, {
        limit: 10,
      });
      const totalForItem = summaries.data.reduce((acc, s) => acc + (s.total_usage || 0), 0);

      // Best effort assignment: if we can identify the price used for this item,
      // map to the corresponding metric bucket. Otherwise fall back to traces_recorded.
      const priceObj = item.price as Stripe.Price | string | undefined;
      const priceId = typeof priceObj === 'string' ? priceObj : priceObj?.id;

      // Try to reverse map from known per-metric envs or default
      let assigned = false;
      for (const m of [
        'traces_recorded',
        'agents_tracked',
        'webhooks_delivered',
        'storage_gb',
      ] as BillingMetric[]) {
        if (getPriceIdForMetric(m) === priceId) {
          if (m === 'traces_recorded') report.tracesRecorded += totalForItem;
          else if (m === 'agents_tracked') report.agentsTracked += totalForItem;
          else if (m === 'webhooks_delivered') report.webhooksDelivered += totalForItem;
          else if (m === 'storage_gb') report.storageGb += totalForItem;
          assigned = true;
          break;
        }
      }
      if (!assigned) {
        // default bucket for primary metered usage
        report.tracesRecorded += totalForItem;
      }
    } catch (_) {
      // If summary lookup fails for an item (e.g. non-metered), ignore for this report
    }
  }

  return report;
}

export async function createCheckoutSession(customerId: string, priceId?: string): Promise<string> {
  const stripe = getStripeClient();
  const pid = priceId || getDefaultPriceId();

  // Use configurable or sensible defaults for hosted checkout redirect URLs.
  // In a real app these would come from config / request context.
  const successUrl =
    process.env.STRIPE_SUCCESS_URL ||
    'https://app.agenttrace.io/billing/success?session_id={CHECKOUT_SESSION_ID}';
  const cancelUrl = process.env.STRIPE_CANCEL_URL || 'https://app.agenttrace.io/billing/cancel';

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: pid, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    // allow promotion codes etc if desired
    allow_promotion_codes: true,
  });

  if (!session.url) {
    throw new Error('Failed to create checkout session: no URL returned');
  }
  return session.url;
}

/**
 * Optional class-based client for callers who prefer instances / DI / explicit config.
 * Falls back to env vars when not provided in constructor.
 */
export class StripeBillingClient {
  private stripe: Stripe;
  private defaultPriceId?: string;

  constructor(options?: {
    secretKey?: string;
    priceId?: string;
    apiVersion?: Stripe.LatestApiVersion;
  }) {
    const key = options?.secretKey || process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error('Stripe secret key is required (option or STRIPE_SECRET_KEY)');
    }
    this.stripe = new Stripe(key, {
      apiVersion: options?.apiVersion || '2025-02-24.acacia',
      typescript: true,
    });
    this.defaultPriceId = options?.priceId || process.env.STRIPE_PRICE_ID;
  }

  async createCustomer(email: string, metadata: Record<string, string> = {}): Promise<string> {
    const cust = await this.stripe.customers.create({ email, metadata });
    return cust.id;
  }

  async createSubscription(customerId: string, priceId?: string): Promise<string> {
    const pid = priceId || this.defaultPriceId;
    if (!pid) throw new Error('priceId is required (constructor, param, or STRIPE_PRICE_ID)');
    const sub = await this.stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: pid }],
    });
    return sub.id;
  }

  async recordUsage(customerId: string, metric: BillingMetric, quantity: number): Promise<void> {
    // delegate to module fn but using this stripe instance would require refactor;
    // for simplicity re-implement minimal lookup using private stripe
    if (quantity <= 0) return;
    const subs = await this.stripe.subscriptions.list({
      customer: customerId,
      status: 'active',
      limit: 1,
    });
    if (!subs.data.length) throw new Error(`No active subscription for ${customerId}`);
    const sub = subs.data[0]!;
    let itemId = sub.items.data[0]?.id;
    const targetPid = this.defaultPriceId;
    if (targetPid) {
      const match = sub.items.data.find((i) => {
        const p = typeof i.price === 'string' ? i.price : i.price?.id;
        return p === targetPid;
      });
      if (match) itemId = match.id;
    }
    if (!itemId) throw new Error('No subscription item to record usage against');
    await this.stripe.subscriptionItems.createUsageRecord(itemId, {
      quantity: Math.floor(quantity),
      timestamp: Math.floor(Date.now() / 1000),
      action: 'increment',
    });
  }

  async getUsage(customerId: string, fromDate: number, toDate: number): Promise<UsageReport> {
    // reuse module logic is tricky without exposing; simple impl here
    const subs = await this.stripe.subscriptions.list({
      customer: customerId,
      status: 'active',
      limit: 1,
      expand: ['data.items.data.price'],
    });
    const report: UsageReport = {
      customerId,
      from: fromDate,
      to: toDate,
      tracesRecorded: 0,
      agentsTracked: 0,
      webhooksDelivered: 0,
      storageGb: 0,
    };
    if (!subs.data.length || !subs.data[0]!.items?.data?.length) return report;
    for (const item of subs.data[0]!.items.data) {
      try {
        const sums = await this.stripe.subscriptionItems.listUsageRecordSummaries(item.id, {
          limit: 5,
        });
        const tot = sums.data.reduce((a, s) => a + (s.total_usage || 0), 0);
        report.tracesRecorded += tot; // primary bucket
      } catch (_) {
        /* non-metered item */
      }
    }
    return report;
  }

  async createCheckoutSession(customerId: string, priceId?: string): Promise<string> {
    const pid = priceId || this.defaultPriceId;
    if (!pid) throw new Error('priceId required for checkout');
    const successUrl =
      process.env.STRIPE_SUCCESS_URL ||
      'https://app.agenttrace.io/billing/success?session_id={CHECKOUT_SESSION_ID}';
    const cancelUrl = process.env.STRIPE_CANCEL_URL || 'https://app.agenttrace.io/billing/cancel';
    const sess = await this.stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: pid, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      allow_promotion_codes: true,
    });
    if (!sess.url) throw new Error('No session URL');
    return sess.url;
  }
}
