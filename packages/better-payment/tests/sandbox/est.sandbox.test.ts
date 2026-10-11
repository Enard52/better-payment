import { describe, it, expect } from 'vitest';
import { betterPayment, est as createEst } from '../../src';
import type { EstBank, EstStoreType } from '../../src';
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

const env = requireEnv(
  'EST_SANDBOX_CLIENT_ID',
  'EST_SANDBOX_USERNAME',
  'EST_SANDBOX_PASSWORD',
  'EST_SANDBOX_STORE_KEY'
);
// The test store's card, from the bank or Asseco's test documents
const card = sandboxCard('EST_SANDBOX');
const bank = (process.env.EST_SANDBOX_BANK || 'isbank') as EstBank;
const IP = '85.34.78.112';

const hiddenFields = (html: string): Record<string, string> =>
  Object.fromEntries(
    [...html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map((m) => [
      m[1],
      m[2].replace(/&quot;/g, '"').replace(/&amp;/g, '&'),
    ])
  );

describe.skipIf(!env)('EST sandbox', () => {
  const provider = (storeType: EstStoreType = '3d') =>
    betterPayment({
      mode: 'sandbox',
      providers: {
        est: createEst({
          bank,
          clientId: env!.EST_SANDBOX_CLIENT_ID,
          username: env!.EST_SANDBOX_USERNAME,
          password: env!.EST_SANDBOX_PASSWORD,
          storeKey: env!.EST_SANDBOX_STORE_KEY,
          storeType,
        }),
      },
    }).est;

  it('reports an unknown order as failure instead of throwing', async () => {
    const result = await provider().getPayment(orderId('ESTNONE'));
    record('est', 'status-unknown-order', result.rawResponse);
    expect(result.status).toBe(PaymentStatus.FAILURE);
    expect(result.errorMessage).toBeTruthy();
  });

  describe.skipIf(!card)('with a test card', () => {
    // The 3D gate answers a form with a bad hash by posting Response=Error back
    // to failUrl; a valid form goes on to 3D Secure or the bank's payment page
    it.each(['3d', '3d_pay', '3d_pay_hosting', '3d_host'] as const)(
      'the 3D gate accepts the signed %s form',
      async (storeType) => {
        const init = await provider(storeType).initThreeDSPayment(
          threeDSRequest(card!, { conversationId: orderId('EST3D') })
        );
        expect(init.status, describeResult(init)).toBe(PaymentStatus.PENDING);

        const html = init.threeDSHtmlContent!;
        const action = /action="([^"]+)"/.exec(html)![1];
        const response = await fetch(action, {
          method: 'POST',
          body: new URLSearchParams(hiddenFields(html)),
          redirect: 'manual',
        });
        const page = await response.text();
        expect(response.status).toBe(200);
        expect(page).not.toMatch(/name="Response" value="Error"/);
      }
    );

    it('charges, looks up and cancels a non-3D payment', async () => {
      const est = provider();
      const id = orderId('EST');
      const payment = await withSandboxRetry(() =>
        est.createPayment(paymentRequest(card!, { conversationId: id }))
      );
      record('est', 'create-payment', payment.rawResponse);
      expect(payment.status, describeResult(payment)).toBe(PaymentStatus.SUCCESS);

      const lookup = await est.getPayment(id);
      record('est', 'get-payment', lookup.rawResponse);
      expect(lookup.status, describeResult(lookup)).toBe(PaymentStatus.SUCCESS);

      const cancel = await est.cancel({ paymentId: id, ip: IP });
      record('est', 'cancel', cancel.rawResponse);
      expect(cancel.status, describeResult(cancel)).toBe(PaymentStatus.SUCCESS);

      const voided = await est.getPayment(id);
      expect(voided.status, describeResult(voided)).toBe(PaymentStatus.CANCELLED);
    });

    it('refunds part of a payment', async () => {
      const est = provider();
      const id = orderId('ESTR');
      const payment = await withSandboxRetry(() =>
        est.createPayment(paymentRequest(card!, { conversationId: id, price: '2', paidPrice: '2' }))
      );
      expect(payment.status, describeResult(payment)).toBe(PaymentStatus.SUCCESS);

      const refund = await est.refund({ paymentId: id, price: '0.5', currency: 'TRY', ip: IP });
      record('est', 'refund', refund.rawResponse);
      expect(refund.status, describeResult(refund)).toBe(PaymentStatus.SUCCESS);

      const refunded = await est.getPayment(id);
      expect(refunded.status, describeResult(refunded)).toBe(PaymentStatus.CANCELLED);
    });
  });
});
