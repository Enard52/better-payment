import { describe, it, expect, vi } from 'vitest';
import { betterPayment, PaymentStatus } from 'better-payment';
import { MockProvider } from 'better-payment/testing';
import { paymentLinks, MemoryPaymentLinkStore } from '../../../src/plugins/payment-links';
import { mockPaymentCard, mockBuyer, mockShippingAddress, mockBillingAddress } from '../../fixtures/payment-data';

describe('paymentLinks plugin', () => {
  const SECRET = 'super-secret-key-12345';
  const BASE_URL = 'https://shop.example.com/api/payment';

  function createTestPayment(options = {}) {
    const store = new MemoryPaymentLinkStore();
    const plugin = paymentLinks({
      secret: SECRET,
      baseUrl: BASE_URL,
      store,
      ...options,
    });

    const payment = betterPayment({
      providers: { mock: new MockProvider() },
      plugins: [plugin],
      handler: { basePath: '/api/payment' },
    });

    return { payment, store, plugin };
  }

  it('creates signed payment links with URL and HMAC signature', async () => {
    const { payment } = createTestPayment();

    const link = await payment.links.create({
      amount: '250.00',
      currency: 'TRY',
      description: 'Consulting invoice #42',
      expiresIn: '7d',
    });

    expect(link.id).toBeDefined();
    expect(link.amount).toBe('250.00');
    expect(link.currency).toBe('TRY');
    expect(link.description).toBe('Consulting invoice #42');
    expect(link.status).toBe('open');
    expect(link.singleUse).toBe(true);
    expect(link.useCount).toBe(0);
    expect(link.signature).toHaveLength(64); // SHA-256 hex
    expect(link.url).toContain(`${BASE_URL}/links/resolve?id=${link.id}&sig=${link.signature}`);

    const isValid = await payment.links.verify(link);
    expect(isValid).toBe(true);
  });

  it('detects tampering when amount or currency is altered', async () => {
    const { payment } = createTestPayment();

    const link = await payment.links.create({
      amount: '100.00',
      currency: 'TRY',
    });

    // Tamper with the amount
    const tampered = { ...link, amount: '10.00' };
    const isValid = await payment.links.verify(tampered);
    expect(isValid).toBe(false);
  });

  it('handles expiration correctly', async () => {
    const { payment } = createTestPayment();

    // Create a link that expired 1 second ago
    const link = await payment.links.create({
      amount: '50.00',
      expiresIn: -1000,
    });

    const fetched = await payment.links.get(link.id);
    expect(fetched?.status).toBe('expired');
  });

  it('cancels active payment links', async () => {
    const { payment } = createTestPayment();

    const link = await payment.links.create({ amount: '75.00' });
    expect(link.status).toBe('open');

    const cancelled = await payment.links.cancel(link.id);
    expect(cancelled?.status).toBe('cancelled');

    const refetched = await payment.links.get(link.id);
    expect(refetched?.status).toBe('cancelled');
  });

  it('resolves and pays single-use links via handler endpoints', async () => {
    const { payment } = createTestPayment();
    const handler = payment.handler;

    const link = await payment.links.create({
      amount: '120.00',
      currency: 'TRY',
      description: 'Single-use order #101',
      singleUse: true,
    });

    // 1. Resolve endpoint
    const resolveRes = await handler.handle({
      method: 'GET',
      url: `${BASE_URL}/links/resolve?id=${link.id}`,
      headers: {},
    });

    expect(resolveRes.status).toBe(200);
    const resolvedBody =
      typeof resolveRes.body === 'string' ? JSON.parse(resolveRes.body) : resolveRes.body;
    expect(resolvedBody.amount).toBe('120.00');
    expect(resolvedBody.status).toBe('open');

    // 2. Pay endpoint
    const payRes = await handler.handle({
      method: 'POST',
      url: `${BASE_URL}/links/pay`,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        linkId: link.id,
        paymentCard: mockPaymentCard,
        buyer: mockBuyer,
        shippingAddress: mockShippingAddress,
        billingAddress: mockBillingAddress,
      }),
    });

    expect(payRes.status).toBe(200);
    const payBody = typeof payRes.body === 'string' ? JSON.parse(payRes.body) : payRes.body;
    expect(payBody.status).toBe(PaymentStatus.SUCCESS);

    // 3. Link should now be marked as 'paid'
    const updatedLink = await payment.links.get(link.id);
    expect(updatedLink?.status).toBe('paid');
    expect(updatedLink?.useCount).toBe(1);
    expect(updatedLink?.paidAt).toBeDefined();

    // 4. Paying again should return 410 (already paid)
    const payAgainRes = await handler.handle({
      method: 'POST',
      url: `${BASE_URL}/links/pay`,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        linkId: link.id,
        paymentCard: mockPaymentCard,
        buyer: mockBuyer,
        shippingAddress: mockShippingAddress,
        billingAddress: mockBillingAddress,
      }),
    });

    expect(payAgainRes.status).toBe(410);
  });

  it('supports multi-use links that remain open after payment', async () => {
    const { payment } = createTestPayment();
    const handler = payment.handler;

    const link = await payment.links.create({
      amount: '50.00',
      currency: 'TRY',
      description: 'Donation link',
      singleUse: false,
    });

    // Pay first time
    const res1 = await handler.handle({
      method: 'POST',
      url: `${BASE_URL}/links/pay`,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        linkId: link.id,
        paymentCard: mockPaymentCard,
        buyer: mockBuyer,
        shippingAddress: mockShippingAddress,
        billingAddress: mockBillingAddress,
      }),
    });
    expect(res1.status).toBe(200);

    const afterFirstPay = await payment.links.get(link.id);
    expect(afterFirstPay?.status).toBe('open');
    expect(afterFirstPay?.useCount).toBe(1);

    // Pay second time
    const res2 = await handler.handle({
      method: 'POST',
      url: `${BASE_URL}/links/pay`,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        linkId: link.id,
        paymentCard: mockPaymentCard,
        buyer: mockBuyer,
        shippingAddress: mockShippingAddress,
        billingAddress: mockBillingAddress,
      }),
    });
    expect(res2.status).toBe(200);

    const afterSecondPay = await payment.links.get(link.id);
    expect(afterSecondPay?.status).toBe('open');
    expect(afterSecondPay?.useCount).toBe(2);
  });
});
