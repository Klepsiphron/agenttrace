/**
 * Tests for Stripe billing integration (mocked)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { BillingMetric } from './types.js';

// We will mock the 'stripe' module entirely
const mockCustomersCreate = vi.fn();
const mockSubscriptionsCreate = vi.fn();
const mockSubscriptionsList = vi.fn();
const mockSubscriptionItemsCreateUsageRecord = vi.fn();
const mockSubscriptionItemsListUsageRecordSummaries = vi.fn();
const mockCheckoutSessionsCreate = vi.fn();

vi.mock('stripe', () => {
  return {
    default: class MockStripe {
      customers = {
        create: mockCustomersCreate,
      };
      subscriptions = {
        create: mockSubscriptionsCreate,
        list: mockSubscriptionsList,
      };
      subscriptionItems = {
        createUsageRecord: mockSubscriptionItemsCreateUsageRecord,
        listUsageRecordSummaries: mockSubscriptionItemsListUsageRecordSummaries,
      };
      checkout = {
        sessions: {
          create: mockCheckoutSessionsCreate,
        },
      };
      constructor(_key: string, _opts?: unknown) {
        // capture if desired
      }
    },
  };
});

import {
  createCustomer,
  createSubscription,
  recordUsage,
  getUsage,
  createCheckoutSession,
  StripeBillingClient,
} from './stripe.js';

const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  // restore and selectively set for tests
  process.env = { ...ORIGINAL_ENV };
}

function setStripeEnv() {
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock_123';
  process.env.STRIPE_PRICE_ID = 'price_test_123';
  delete process.env.STRIPE_WEBHOOK_SECRET; // optional
}

beforeEach(() => {
  vi.clearAllMocks();
  resetEnv();
  // reset the cached stripe instance between tests by re-requiring would be ideal,
  // but since we use top level import, we can force by deleting the module state if exposed.
  // For now, each test that needs fresh will set env before calling.
  // The internal _stripe cache will be hit; to avoid cross test pollution we set env early.
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe('@agenttrace-io/billing stripe integration (mocked)', () => {
  it('exports package constants', async () => {
    const mod = await import('./index.js');
    expect(mod.PACKAGE_NAME).toBe('@agenttrace-io/billing');
    expect(mod.VERSION).toBe('0.1.0');
  });

  it('createCustomer calls Stripe and returns id', async () => {
    setStripeEnv();
    mockCustomersCreate.mockResolvedValueOnce({ id: 'cus_abc123' });

    const id = await createCustomer('user@example.com', { org: 'acme' });

    expect(id).toBe('cus_abc123');
    expect(mockCustomersCreate).toHaveBeenCalledWith({
      email: 'user@example.com',
      metadata: { org: 'acme' },
    });
  });

  it('createCustomer requires STRIPE_SECRET_KEY', async () => {
    // no key set
    delete process.env.STRIPE_SECRET_KEY;
    await expect(createCustomer('a@b.com')).rejects.toThrow(/STRIPE_SECRET_KEY/);
  });

  it('createSubscription creates sub with default price', async () => {
    setStripeEnv();
    mockSubscriptionsCreate.mockResolvedValueOnce({ id: 'sub_xyz789' });

    const subId = await createSubscription('cus_abc123');

    expect(subId).toBe('sub_xyz789');
    expect(mockSubscriptionsCreate).toHaveBeenCalledWith({
      customer: 'cus_abc123',
      items: [{ price: 'price_test_123' }],
      expand: ['items.data.price'],
    });
  });

  it('createSubscription accepts explicit priceId', async () => {
    setStripeEnv();
    mockSubscriptionsCreate.mockResolvedValueOnce({ id: 'sub_custom' });

    await createSubscription('cus_1', 'price_custom_999');

    expect(mockSubscriptionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [{ price: 'price_custom_999' }],
      })
    );
  });

  it('createSubscription requires price (env or arg)', async () => {
    setStripeEnv();
    delete process.env.STRIPE_PRICE_ID;
    await expect(createSubscription('cus_1')).rejects.toThrow(/STRIPE_PRICE_ID/);
  });

  it('recordUsage finds sub item and creates usage record with metric metadata', async () => {
    setStripeEnv();
    mockSubscriptionsList.mockResolvedValueOnce({
      data: [
        {
          id: 'sub_1',
          items: {
            data: [{ id: 'si_999', price: { id: 'price_test_123' } }],
          },
        },
      ],
    });
    mockSubscriptionItemsCreateUsageRecord.mockResolvedValueOnce({ id: 'ur_1' });

    await recordUsage('cus_abc', 'traces_recorded', 42);

    expect(mockSubscriptionsList).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_abc', status: 'active' })
    );
    expect(mockSubscriptionItemsCreateUsageRecord).toHaveBeenCalledWith('si_999', {
      quantity: 42,
      timestamp: expect.any(Number),
      action: 'increment',
      metadata: { metric: 'traces_recorded' },
    });
  });

  it('recordUsage skips when quantity <= 0', async () => {
    setStripeEnv();
    await recordUsage('cus_1', 'traces_recorded', 0);
    await recordUsage('cus_1', 'traces_recorded', -5);
    expect(mockSubscriptionsList).not.toHaveBeenCalled();
    expect(mockSubscriptionItemsCreateUsageRecord).not.toHaveBeenCalled();
  });

  it('recordUsage supports per-metric price env override', async () => {
    setStripeEnv();
    process.env.STRIPE_PRICE_TRACES_RECORDED = 'price_traces_special';
    mockSubscriptionsList.mockResolvedValueOnce({
      data: [
        {
          id: 'sub_2',
          items: {
            data: [
              { id: 'si_base', price: { id: 'price_test_123' } },
              { id: 'si_traces', price: { id: 'price_traces_special' } },
            ],
          },
        },
      ],
    });
    mockSubscriptionItemsCreateUsageRecord.mockResolvedValueOnce({});

    await recordUsage('cus_x', 'traces_recorded', 7);

    expect(mockSubscriptionItemsCreateUsageRecord).toHaveBeenCalledWith('si_traces', expect.any(Object));
  });

  it('recordUsage throws when no active subscription', async () => {
    setStripeEnv();
    mockSubscriptionsList.mockResolvedValueOnce({ data: [] });
    await expect(recordUsage('cus_no_sub', 'agents_tracked', 1)).rejects.toThrow(/No active subscription/);
  });

  it('getUsage returns a UsageReport structure (uses summaries)', async () => {
    setStripeEnv();
    mockSubscriptionsList.mockResolvedValueOnce({
      data: [
        {
          id: 'sub_u',
          items: {
            data: [
              {
                id: 'si_u1',
                price: { id: 'price_test_123' },
              },
            ],
          },
        },
      ],
    });
    mockSubscriptionItemsListUsageRecordSummaries.mockResolvedValueOnce({
      data: [{ total_usage: 123 }, { total_usage: 7 }],
    });

    const report = await getUsage('cus_u', Date.now() - 86400000, Date.now());

    expect(report).toMatchObject({
      customerId: 'cus_u',
      tracesRecorded: 130, // 123+7
      agentsTracked: 0,
      webhooksDelivered: 0,
      storageGb: 0,
    });
    expect(report.from).toBeGreaterThan(0);
    expect(report.to).toBeGreaterThan(0);
  });

  it('getUsage returns zeros when no subscription', async () => {
    setStripeEnv();
    mockSubscriptionsList.mockResolvedValueOnce({ data: [] });

    const report = await getUsage('cus_empty', 100, 200);
    expect(report.tracesRecorded).toBe(0);
    expect(report.customerId).toBe('cus_empty');
  });

  it('createCheckoutSession creates a session and returns url', async () => {
    setStripeEnv();
    mockCheckoutSessionsCreate.mockResolvedValueOnce({ url: 'https://checkout.stripe.com/pay/cs_test_123' });

    const url = await createCheckoutSession('cus_check');

    expect(url).toContain('checkout.stripe.com');
    expect(mockCheckoutSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'cus_check',
        mode: 'subscription',
        line_items: [{ price: 'price_test_123', quantity: 1 }],
      })
    );
  });

  it('createCheckoutSession requires price', async () => {
    setStripeEnv();
    delete process.env.STRIPE_PRICE_ID;
    await expect(createCheckoutSession('cus_1')).rejects.toThrow(/STRIPE_PRICE_ID/);
  });

  it('StripeBillingClient supports explicit key/price and delegates core flows', async () => {
    const client = new StripeBillingClient({
      secretKey: 'sk_test_client',
      priceId: 'price_from_ctor',
    });

    mockCustomersCreate.mockResolvedValueOnce({ id: 'cus_c' });
    const cid = await client.createCustomer('c@example.com');
    expect(cid).toBe('cus_c');

    mockSubscriptionsCreate.mockResolvedValueOnce({ id: 'sub_c' });
    const sid = await client.createSubscription('cus_c');
    expect(sid).toBe('sub_c');

    mockSubscriptionsList.mockResolvedValueOnce({
      data: [{ id: 'sub_c', items: { data: [{ id: 'si_c', price: 'price_from_ctor' }] } }],
    });
    mockSubscriptionItemsCreateUsageRecord.mockResolvedValueOnce({});
    await client.recordUsage('cus_c', 'webhooks_delivered', 200);
    expect(mockSubscriptionItemsCreateUsageRecord).toHaveBeenCalled();

    mockCheckoutSessionsCreate.mockResolvedValueOnce({ url: 'https://co.stripe.test' });
    const curl = await client.createCheckoutSession('cus_c');
    expect(curl).toBe('https://co.stripe.test');
  });

  it('StripeBillingClient getUsage works', async () => {
    const client = new StripeBillingClient({ secretKey: 'sk_x', priceId: 'p_x' });
    mockSubscriptionsList.mockResolvedValueOnce({
      data: [{ items: { data: [{ id: 'si_x', price: { id: 'p_x' } }] } }],
    });
    mockSubscriptionItemsListUsageRecordSummaries.mockResolvedValueOnce({ data: [{ total_usage: 55 }] });

    const r = await client.getUsage('cus_g', 0, 1);
    expect(r.tracesRecorded).toBe(55);
  });
});
