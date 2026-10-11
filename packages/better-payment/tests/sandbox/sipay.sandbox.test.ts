import { describe, it, expect } from 'vitest';
import { betterPayment, sipay as createSipay } from '../../src';
import { PaymentErrorCode } from '../../src/core/error-codes';
import { PaymentStatus } from '../../src/types';
import {
  describeResult,
  orderId,
  paymentRequest,
  record,
  requireEnv,
  sandboxCard,
  threeDSRequest,
  withSandboxRetry,
} from './setup';

// Sipay's API documentation lists a shared test merchant; set these to its
// credentials (or your own test merchant's)
const env = requireEnv(
  'SIPAY_SANDBOX_APP_ID',
  'SIPAY_SANDBOX_APP_SECRET',
  'SIPAY_SANDBOX_MERCHANT_KEY'
);

// Sipay test cards: CVV 000 approves, other CVVs simulate bank errors
const card = sandboxCard('SIPAY_SANDBOX', {
  cardHolderName: 'Test User',
  cardNumber: '4508034508034509',
  expireMonth: '12',
  expireYear: '2030',
  cvc: '000',
})!;

describe.skipIf(!env)('Sipay sandbox', () => {
  const sipay = !env
    ? (undefined as never)
    : betterPayment({
        mode: 'sandbox',
        providers: {
          sipay: createSipay({
            appId: env.SIPAY_SANDBOX_APP_ID,
            appSecret: env.SIPAY_SANDBOX_APP_SECRET,
            merchantKey: env.SIPAY_SANDBOX_MERCHANT_KEY,
          }),
        },
      }).sipay;

  it('charges, looks up and refunds part of a payment', async () => {
    const id = orderId('SIP');
    const payment = await withSandboxRetry(() =>
      sipay.createPayment(paymentRequest(card, { conversationId: id }))
    );
    record('sipay', 'create-payment', payment.rawResponse);
    expect(payment.status, describeResult(payment)).toBe(PaymentStatus.SUCCESS);

    const lookup = await sipay.getPayment(id);
    record('sipay', 'get-payment', lookup.rawResponse);
    expect(lookup.status, describeResult(lookup)).toBe(PaymentStatus.SUCCESS);

    const refund = await sipay.refund({
      paymentId: id,
      price: '0.5',
      currency: 'TRY',
      ip: '85.34.78.112',
    });
    record('sipay', 'refund', refund.rawResponse);
    expect(refund.status, describeResult(refund)).toBe(PaymentStatus.SUCCESS);
  });

  it('cancels a payment', async () => {
    const id = orderId('SIP');
    const payment = await withSandboxRetry(() =>
      sipay.createPayment(paymentRequest(card, { conversationId: id }))
    );
    expect(payment.status, describeResult(payment)).toBe(PaymentStatus.SUCCESS);

    const cancel = await sipay.cancel({ paymentId: id, ip: '85.34.78.112' });
    record('sipay', 'cancel', cancel.rawResponse);
    expect(cancel.status, describeResult(cancel)).toBe(PaymentStatus.SUCCESS);
    expect((await sipay.getPayment(id)).status).toBe(PaymentStatus.CANCELLED);
  });

  it('reports a bank decline with its normalized code', async () => {
    const payment = await withSandboxRetry(() =>
      sipay.createPayment(
        paymentRequest({ ...card, cvc: '510' }, { conversationId: orderId('SIP') })
      )
    );
    record('sipay', 'create-payment-declined', payment.rawResponse);
    expect(payment.status).toBe(PaymentStatus.FAILURE);
    expect(payment.code).toBe(PaymentErrorCode.INSUFFICIENT_FUNDS);
  });

  it('pre-authorizes and captures part of the amount', async () => {
    const id = orderId('SIP');
    const auth = await withSandboxRetry(() =>
      sipay.authorize(paymentRequest(card, { conversationId: id }))
    );
    expect(auth.status, describeResult(auth)).toBe(PaymentStatus.SUCCESS);

    const capture = await sipay.capture({ paymentId: id, amount: '0.8', ip: '85.34.78.112' });
    record('sipay', 'capture', capture.rawResponse);
    expect(capture.status, describeResult(capture)).toBe(PaymentStatus.SUCCESS);
  });

  it('returns the 3D Secure page', async () => {
    const init = await withSandboxRetry(() =>
      sipay.initThreeDSPayment(threeDSRequest(card, { conversationId: orderId('SIP') }))
    );
    expect(init.status, describeResult(init)).toBe(PaymentStatus.PENDING);
    expect(init.threeDSHtmlContent).toContain('<form');
  });

  it('reports an unknown invoice id as failure instead of throwing', async () => {
    const result = await sipay.getPayment(orderId('SIPNONE'));
    record('sipay', 'status-unknown-order', result.rawResponse);
    expect(result.status).toBe(PaymentStatus.FAILURE);
    expect(result.errorMessage).toBeTruthy();
  });

  it('lists installment options for a BIN', async () => {
    const result = await sipay.installmentInfo({ binNumber: '540667', price: '100' });
    expect(result.status, describeResult(result)).toBe(PaymentStatus.SUCCESS);
    expect(result.installmentDetails?.[0].installmentPrices.length).toBeGreaterThan(0);
  });
});
