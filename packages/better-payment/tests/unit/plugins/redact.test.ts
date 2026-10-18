import { describe, it, expect, vi } from 'vitest';
import {
  betterPayment,
  PaymentStatus,
  type PaymentRequest,
  type PaymentResponse,
} from 'better-payment';
import { redact } from 'better-payment/plugins';
import { MockProvider } from 'better-payment/testing';
import { mockPaymentRequest } from '../../fixtures/payment-data';

describe('redact plugin', () => {
  it('masks card details and personal data in events while provider receives real data', async () => {
    const provider = new MockProvider();

    let providerReceivedRequest: any = null;
    vi.spyOn(provider, 'createPayment').mockImplementation(async (req) => {
      // Record what the provider actually received
      providerReceivedRequest = JSON.parse(JSON.stringify(req));
      return {
        status: PaymentStatus.SUCCESS,
        paymentId: 'pay_123',
        rawResponse: {
          note: 'Processed for card 5528790000000008 with TCKN 12345678901',
        },
      } as PaymentResponse;
    });

    const receivedEvents: any[] = [];

    const payment = betterPayment({
      providers: { mock: provider },
      defaultProvider: 'mock',
      plugins: [
        redact({
          card: 'first6last4',
        }),
      ],
    });

    payment.on('payment.succeeded', (event) => {
      receivedEvents.push(event);
    });

    const requestWithSensitiveData: PaymentRequest = {
      ...mockPaymentRequest,
      paymentCard: {
        ...mockPaymentRequest.paymentCard!,
        cardNumber: '5528790000000008',
        cvc: '123',
        expireMonth: '12',
        expireYear: '2028',
      },
      buyer: {
        ...mockPaymentRequest.buyer,
        identityNumber: '12345678901',
        gsmNumber: '+905321112233',
      },
    };

    const res = await payment.createPayment(requestWithSensitiveData);

    // 1. Provider must receive the untouched, real card number and CVC!
    expect(providerReceivedRequest.paymentCard.cardNumber).toBe('5528790000000008');
    expect(providerReceivedRequest.paymentCard.cvc).toBe('123');
    expect(providerReceivedRequest.buyer.identityNumber).toBe('12345678901');

    // 2. Event listener MUST receive masked data!
    expect(receivedEvents).toHaveLength(1);
    const event = receivedEvents[0];
    const eventCard = (event.request as PaymentRequest).paymentCard;
    const eventBuyer = (event.request as PaymentRequest).buyer;

    expect(eventCard?.cardNumber).toBe('552879******0008');
    expect(eventCard?.cvc).toBe('***');
    expect(eventCard?.expireMonth).toBe('<redacted>');
    expect(eventCard?.expireYear).toBe('<redacted>');
    expect(eventBuyer?.identityNumber).toBe('<redacted>');
    expect(eventBuyer?.gsmNumber).toBe('<redacted>');

    // 3. Raw response embedded in result must also mask PAN and TCKN
    expect((res.rawResponse as any).note).toBe(
      'Processed for card 552879******0008 with TCKN <redacted>'
    );
  });

  it('wraps logger to mask card numbers, CVC and TCKN from log output', async () => {
    const baseInfo = vi.fn();
    const logger = {
      debug: vi.fn(),
      info: baseInfo,
      error: vi.fn(),
    };

    const provider = new MockProvider({ logger });

    const payment = betterPayment({
      providers: { mock: provider },
      defaultProvider: 'mock',
      logger,
      plugins: [redact()],
    });

    // When an application or provider logs
    logger.info('Received payment request for 5454540000005454, TCKN: 98765432109', {
      cardNumber: '5454540000005454',
      cvc: '999',
      identityNumber: '98765432109',
    });

    expect(baseInfo).toHaveBeenCalledWith(
      'Received payment request for 545454******5454, TCKN: <redacted>',
      {
        cardNumber: '545454******5454',
        cvc: '***',
        identityNumber: '<redacted>',
      }
    );
  });

  it('supports different card masking styles (last4, none, custom)', async () => {
    const provider = new MockProvider();
    vi.spyOn(provider, 'createPayment').mockResolvedValue({
      status: PaymentStatus.SUCCESS,
      paymentId: 'pay_test',
    } as PaymentResponse);

    // Style 1: last4
    let capturedEvent: any = null;
    const paymentLast4 = betterPayment({
      providers: { mock: provider },
      defaultProvider: 'mock',
      plugins: [redact({ card: 'last4' })],
    });
    paymentLast4.on('payment.succeeded', (e) => {
      capturedEvent = e;
    });

    await paymentLast4.createPayment({
      ...mockPaymentRequest,
      paymentCard: { ...mockPaymentRequest.paymentCard!, cardNumber: '4543600000001234' },
    });
    expect((capturedEvent.request as PaymentRequest).paymentCard?.cardNumber).toBe(
      '************1234'
    );

    // Style 2: none
    const paymentNone = betterPayment({
      providers: { mock: provider },
      defaultProvider: 'mock',
      plugins: [redact({ card: 'none' })],
    });
    paymentNone.on('payment.succeeded', (e) => {
      capturedEvent = e;
    });

    await paymentNone.createPayment({
      ...mockPaymentRequest,
      paymentCard: { ...mockPaymentRequest.paymentCard!, cardNumber: '4543600000001234' },
    });
    expect((capturedEvent.request as PaymentRequest).paymentCard?.cardNumber).toBe('<redacted>');

    // Style 3: custom function
    const paymentCustom = betterPayment({
      providers: { mock: provider },
      defaultProvider: 'mock',
      plugins: [redact({ card: (pan) => `CARD-${pan.slice(-4)}` })],
    });
    paymentCustom.on('payment.succeeded', (e) => {
      capturedEvent = e;
    });

    await paymentCustom.createPayment({
      ...mockPaymentRequest,
      paymentCard: { ...mockPaymentRequest.paymentCard!, cardNumber: '4543600000001234' },
    });
    expect((capturedEvent.request as PaymentRequest).paymentCard?.cardNumber).toBe('CARD-1234');
  });

  it('exposes payment.redact utility methods for manual masking', () => {
    const payment = betterPayment({
      providers: { mock: new MockProvider() },
      plugins: [redact()],
    });

    expect((payment as any).redact.maskCard('5528790000000008')).toBe('552879******0008');

    const masked = (payment as any).redact.mask({
      user: 'Ali',
      cardNumber: '5528790000000008',
      cvc: '456',
      identityNumber: '11122233344',
      extra: 'Customer phone is 05554443322',
    });

    expect(masked).toEqual({
      user: 'Ali',
      cardNumber: '552879******0008',
      cvc: '***',
      identityNumber: '<redacted>',
      extra: 'Customer phone is <redacted>',
    });
  });
});
