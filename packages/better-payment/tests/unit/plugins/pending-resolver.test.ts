import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { betterPayment, PaymentStatus, PaymentErrorCode, type PaymentEvent } from 'better-payment';
import { MockProvider, MOCK_CARDS } from 'better-payment/testing';
import { pendingResolver } from 'better-payment/plugins';
import { mockPaymentRequest } from '../../fixtures/payment-data';

describe('pendingResolver plugin', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('records pending payment with NETWORK_ERROR and resolves to succeeded', async () => {
    const mock = new MockProvider();
    const createPaymentSpy = vi.spyOn(mock, 'createPayment');
    const getPaymentSpy = vi.spyOn(mock, 'getPayment');

    const succeededEvents: PaymentEvent[] = [];

    const payment = betterPayment({
      providers: { mock },
      plugins: [
        pendingResolver({
          schedule: ['10s', '1m'],
          giveUpAfter: '1h',
        }),
      ],
    });

    payment.on('payment.succeeded', (event) => {
      succeededEvents.push(event);
    });

    // Simulate network error on createPayment: payment processed by bank, but response lost
    mock.networkErrorNext('payment');
    const initResult = await payment.createPayment({
      ...mockPaymentRequest,
      conversationId: 'ORDER-101',
    });

    expect(initResult.status).toBe(PaymentStatus.PENDING);
    expect(initResult.code).toBe(PaymentErrorCode.NETWORK_ERROR);

    // Verify it was saved to pending store
    const listBefore = await payment.pending.list();
    expect(listBefore.length).toBe(1);
    expect(listBefore[0].id).toBe(initResult.paymentId);
    expect(listBefore[0].conversationId).toBe('ORDER-101');

    // Trying resolve immediately before schedule should skip it
    const earlySummary = await payment.pending.resolve();
    expect(earlySummary.checked).toBe(0);

    // Advance time past first schedule (10s)
    vi.advanceTimersByTime(11_000);

    // Now resolve
    const summary = await payment.pending.resolve();
    expect(summary.checked).toBe(1);
    expect(summary.succeeded).toBe(1);

    // Payment should be removed from store
    const listAfter = await payment.pending.list();
    expect(listAfter.length).toBe(0);

    // Verify event was emitted with resolvedFrom: 'pending'
    expect(succeededEvents.length).toBe(1);
    expect(succeededEvents[0].resolvedFrom).toBe('pending');
    expect(succeededEvents[0].paymentId).toBe(initResult.paymentId);

    // Verify createPayment was NOT called again (read-only query)
    expect(createPaymentSpy).toHaveBeenCalledTimes(1);
    expect(getPaymentSpy).toHaveBeenCalledTimes(1);
  });

  it('resolves pending payment to failed when getPayment reports failure', async () => {
    const mock = new MockProvider();
    const failedEvents: PaymentEvent[] = [];

    const payment = betterPayment({
      providers: { mock },
      plugins: [
        pendingResolver({
          schedule: ['10s'],
          giveUpAfter: '1h',
        }),
      ],
    });

    payment.on('payment.failed', (event) => {
      failedEvents.push(event);
    });

    mock.networkErrorNext('payment');
    const initResult = await payment.createPayment({
      ...mockPaymentRequest,
      conversationId: 'ORDER-102',
    });

    // Next getPayment call returns failure
    vi.spyOn(mock, 'getPayment').mockResolvedValueOnce({
      status: PaymentStatus.FAILURE,
      code: PaymentErrorCode.CARD_DECLINED,
      errorMessage: 'Declined by bank',
      paymentId: initResult.paymentId,
      conversationId: 'ORDER-102',
    });

    vi.advanceTimersByTime(11_000);
    const summary = await payment.pending.resolve();

    expect(summary.failed).toBe(1);
    expect(failedEvents.length).toBe(1);
    expect(failedEvents[0].resolvedFrom).toBe('pending');
    expect(failedEvents[0].code).toBe(PaymentErrorCode.CARD_DECLINED);

    const remaining = await payment.pending.list();
    expect(remaining.length).toBe(0);
  });

  it('gives up after giveUpAfter and emits payment.unresolved event', async () => {
    const mock = new MockProvider();
    const unresolvedEvents: PaymentEvent[] = [];

    const payment = betterPayment({
      providers: { mock },
      plugins: [
        pendingResolver({
          schedule: ['1m'],
          giveUpAfter: '30m',
        }),
      ],
    });

    payment.on('payment.unresolved', (event) => {
      unresolvedEvents.push(event);
    });

    mock.networkErrorNext('payment');
    const initResult = await payment.createPayment({
      ...mockPaymentRequest,
      conversationId: 'ORDER-103',
    });

    // Advance beyond giveUpAfter (31 minutes)
    vi.advanceTimersByTime(31 * 60 * 1000);

    const summary = await payment.pending.resolve();
    expect(summary.unresolved).toBe(1);
    expect(unresolvedEvents.length).toBe(1);
    expect(unresolvedEvents[0].paymentId).toBe(initResult.paymentId);

    const remaining = await payment.pending.list();
    expect(remaining.length).toBe(0);
  });

  it('supports manual inspection and deletion through pending methods', async () => {
    const mock = new MockProvider();
    const payment = betterPayment({
      providers: { mock },
      plugins: [
        pendingResolver({
          schedule: ['10s'],
        }),
      ],
    });

    mock.networkErrorNext('payment');
    const res = await payment.createPayment(mockPaymentRequest);

    const item = await payment.pending.get(res.paymentId!);
    expect(item).toBeDefined();
    expect(item?.id).toBe(res.paymentId);

    await payment.pending.delete(res.paymentId!);
    const deleted = await payment.pending.get(res.paymentId!);
    expect(deleted).toBeUndefined();
  });
});
