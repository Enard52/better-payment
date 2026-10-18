import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  betterPayment,
  ConfigurationError,
  definePlugin,
  PaymentErrorCode,
  PaymentStatus,
} from 'better-payment';
import { MockProvider } from 'better-payment/testing';
import { failover, type FailoverOptions } from 'better-payment/plugins';
import { mockPaymentRequest } from '../../fixtures/payment-data';

function setup(options: FailoverOptions = {}) {
  const a = new MockProvider();
  const b = new MockProvider();
  const c = new MockProvider();

  const spyA = vi.spyOn(a, 'createPayment');
  const spyB = vi.spyOn(b, 'createPayment');
  const spyC = vi.spyOn(c, 'createPayment');

  const payment = betterPayment({
    providers: { a, b, c },
    defaultProvider: 'a',
    plugins: [failover(options)],
  });

  return { payment, a, b, c, spyA, spyB, spyC };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('failover plugin', () => {
  it('switches to backup provider on transient provider error', async () => {
    const onSwitch = vi.fn();
    const { payment, spyA, spyB } = setup({
      order: ['a', 'b'],
      on: ['PROVIDER_ERROR', 'PROVIDER_UNAVAILABLE'],
      onSwitch,
    });

    spyA.mockResolvedValueOnce({
      status: PaymentStatus.FAILURE,
      code: PaymentErrorCode.PROVIDER_ERROR,
      errorCode: 'SYS_500',
      errorMessage: 'Service temporarily down',
    });

    spyB.mockResolvedValueOnce({
      status: PaymentStatus.SUCCESS,
      paymentId: 'pay-b-123',
    });

    const successListener = vi.fn();
    payment.on('payment.succeeded', successListener);

    const result = await payment.createPayment(mockPaymentRequest);

    expect(result.status).toBe(PaymentStatus.SUCCESS);
    expect(result.paymentId).toBe('pay-b-123');
    expect(spyA).toHaveBeenCalledOnce();
    expect(spyB).toHaveBeenCalledOnce();

    expect(onSwitch).toHaveBeenCalledWith(
      expect.objectContaining({
        fromProvider: 'a',
        toProvider: 'b',
        operation: 'createPayment',
        error: expect.objectContaining({
          code: PaymentErrorCode.PROVIDER_ERROR,
          errorCode: 'SYS_500',
        }),
      })
    );

    // Only one payment.succeeded emitted with final provider 'b'
    expect(successListener).toHaveBeenCalledOnce();
    expect(successListener.mock.calls[0][0].provider).toBe('b');
  });

  it('does NOT switch on non-transient card declines (e.g. INSUFFICIENT_FUNDS)', async () => {
    const onSwitch = vi.fn();
    const { payment, spyA, spyB } = setup({
      order: ['a', 'b'],
      onSwitch,
    });

    spyA.mockResolvedValueOnce({
      status: PaymentStatus.FAILURE,
      code: PaymentErrorCode.INSUFFICIENT_FUNDS,
      errorMessage: 'Yetersiz bakiye',
    });

    const result = await payment.createPayment(mockPaymentRequest);

    expect(result.status).toBe(PaymentStatus.FAILURE);
    expect(result.code).toBe(PaymentErrorCode.INSUFFICIENT_FUNDS);
    expect(spyA).toHaveBeenCalledOnce();
    expect(spyB).not.toHaveBeenCalled();
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it('does NOT retry when outcome is unknown (PENDING or NETWORK_ERROR) to prevent double charges', async () => {
    const onSwitch = vi.fn();
    const { payment, spyA, spyB } = setup({
      order: ['a', 'b'],
      onSwitch,
    });

    spyA.mockResolvedValueOnce({
      status: PaymentStatus.PENDING,
      code: PaymentErrorCode.NETWORK_ERROR,
      errorMessage: 'Connection lost after sending payment payload',
    });

    const result = await payment.createPayment(mockPaymentRequest);

    expect(result.status).toBe(PaymentStatus.PENDING);
    expect(result.code).toBe(PaymentErrorCode.NETWORK_ERROR);
    expect(spyA).toHaveBeenCalledOnce();
    expect(spyB).not.toHaveBeenCalled();
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it('trips circuit breaker after configured failures and skips provider', async () => {
    vi.useFakeTimers();
    const { payment, spyA, spyB } = setup({
      order: ['a', 'b'],
      circuitBreaker: {
        failures: 2,
        window: '1m',
        cooldown: '5m',
      },
    });

    spyA.mockResolvedValue({
      status: PaymentStatus.FAILURE,
      code: PaymentErrorCode.PROVIDER_ERROR,
      errorMessage: 'Unavailable',
    });
    spyB.mockResolvedValue({
      status: PaymentStatus.SUCCESS,
      paymentId: 'pay-b',
    });

    // 1st failure on A -> switches to B
    await payment.createPayment(mockPaymentRequest);
    expect(payment.failover.status().a.state).toBe('closed');
    expect(payment.failover.status().a.failures).toBe(1);

    // 2nd failure on A -> trips circuit to open
    await payment.createPayment(mockPaymentRequest);
    expect(payment.failover.status().a.state).toBe('open');
    expect(payment.failover.status().a.cooldownRemainingMs).toBeGreaterThan(0);

    // 3rd payment -> A is open, so A is completely skipped and B is called directly!
    spyA.mockClear();
    spyB.mockClear();
    const result3 = await payment.createPayment(mockPaymentRequest);

    expect(result3.status).toBe(PaymentStatus.SUCCESS);
    expect(spyA).not.toHaveBeenCalled();
    expect(spyB).toHaveBeenCalledOnce();

    // Advance time beyond cooldown (5 minutes)
    vi.advanceTimersByTime(5 * 60 * 1000 + 100);
    expect(payment.failover.status().a.state).toBe('half_open');

    // Next call: trial request on A. If A succeeds, circuit closes!
    spyA.mockResolvedValueOnce({
      status: PaymentStatus.SUCCESS,
      paymentId: 'pay-a-recovered',
    });
    spyA.mockClear();

    const recovered = await payment.createPayment(mockPaymentRequest);
    expect(recovered.paymentId).toBe('pay-a-recovered');
    expect(spyA).toHaveBeenCalledOnce();
    expect(payment.failover.status().a.state).toBe('closed');
  });

  it('works seamlessly with an upstream router plugin', async () => {
    const fakeRouter = definePlugin({
      id: 'mock-router',
      hooks: {
        before: [
          {
            matcher: (ctx) => ctx.routable,
            handler: () => ({ provider: 'b' }),
          },
        ],
      },
    });

    const a = new MockProvider();
    const b = new MockProvider();
    const spyA = vi.spyOn(a, 'createPayment');
    const spyB = vi.spyOn(b, 'createPayment');

    const payment = betterPayment({
      providers: { a, b },
      defaultProvider: 'a',
      plugins: [
        fakeRouter,
        failover({ order: ['a', 'b'] }),
      ],
    });

    // Router selected 'b'. When 'b' encounters transient outage, failover switches to 'a'!
    spyB.mockResolvedValueOnce({
      status: PaymentStatus.FAILURE,
      code: PaymentErrorCode.PROVIDER_ERROR,
    });
    spyA.mockResolvedValueOnce({
      status: PaymentStatus.SUCCESS,
      paymentId: 'pay-a-success',
    });

    const result = await payment.createPayment(mockPaymentRequest);
    expect(result.status).toBe(PaymentStatus.SUCCESS);
    expect(result.paymentId).toBe('pay-a-success');
    expect(spyB).toHaveBeenCalledOnce();
    expect(spyA).toHaveBeenCalledOnce();
  });

  it('allows manual reset and trip of circuit breaker', async () => {
    const { payment } = setup({ circuitBreaker: true });

    expect(payment.failover.status().a.state).toBe('closed');
    payment.failover.trip('a');
    expect(payment.failover.status().a.state).toBe('open');

    payment.failover.reset('a');
    expect(payment.failover.status().a.state).toBe('closed');
  });

  it('throws ConfigurationError on invalid provider in order', async () => {
    const payment = betterPayment({
      providers: { a: new MockProvider() },
      plugins: [failover({ order: ['nonexistent'] })],
    });
    await expect(payment.createPayment(mockPaymentRequest)).rejects.toThrow(ConfigurationError);
  });
});
