import { describe, it, expect, vi } from 'vitest';
import { betterPayment, PaymentStatus } from 'better-payment';
import { MockProvider } from 'better-payment/testing';
import {
  invoicing,
  parasut,
  type InvoicingAdapter,
  type InvoiceResult,
} from 'better-payment/plugins';
import { mockPaymentRequest } from '../../fixtures/payment-data';

describe('invoicing plugin', () => {
  it('creates an invoice automatically on payment.succeeded', async () => {
    const createInvoice = vi.fn().mockResolvedValue({
      id: 'inv-123',
      invoiceNumber: 'EF202600000001',
      status: 'created',
    } satisfies InvoiceResult);

    const mockAdapter: InvoicingAdapter = {
      name: 'mock-invoicing',
      createInvoice,
    };

    const onInvoiceCreated = vi.fn();
    const provider = new MockProvider();
    vi.spyOn(provider, 'createPayment').mockResolvedValue({
      status: PaymentStatus.SUCCESS,
      paymentId: 'pay-777',
      conversationId: 'order-999',
    });

    const payment = betterPayment({
      providers: { mock: provider },
      defaultProvider: 'mock',
      plugins: [
        invoicing({
          adapter: mockAdapter,
          onInvoiceCreated,
        }),
      ],
    });

    const res = await payment.createPayment(mockPaymentRequest);
    expect(res.status).toBe(PaymentStatus.SUCCESS);

    expect(createInvoice).toHaveBeenCalledOnce();
    expect(createInvoice).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: 'pay-777',
        conversationId: 'order-999',
        buyer: expect.objectContaining({
          name: `${mockPaymentRequest.buyer.name} ${mockPaymentRequest.buyer.surname}`,
          email: mockPaymentRequest.buyer.email,
        }),
        items: expect.arrayContaining([
          expect.objectContaining({
            name: mockPaymentRequest.basketItems[0].name,
            unitPrice: mockPaymentRequest.basketItems[0].price,
          }),
        ]),
      })
    );

    expect(onInvoiceCreated).toHaveBeenCalledOnce();
    expect(payment.invoicing.get('pay-777')).toMatchObject({
      paymentId: 'pay-777',
      invoiceId: 'inv-123',
      invoiceNumber: 'EF202600000001',
      status: 'created',
    });
  });

  it('retries on transient failure and records failure when retries exhausted', async () => {
    let callCount = 0;
    const createInvoice = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.reject(new Error('Gateway timeout (504)'));
    });

    const mockAdapter: InvoicingAdapter = {
      name: 'mock-failing',
      createInvoice,
    };

    const onInvoiceFailed = vi.fn();
    const provider = new MockProvider();
    vi.spyOn(provider, 'createPayment').mockResolvedValue({
      status: PaymentStatus.SUCCESS,
      paymentId: 'pay-err-1',
    });

    const payment = betterPayment({
      providers: { mock: provider },
      defaultProvider: 'mock',
      plugins: [
        invoicing({
          adapter: mockAdapter,
          retry: { attempts: 2, delay: 10 },
          onInvoiceFailed,
        }),
      ],
    });

    await payment.createPayment(mockPaymentRequest);

    expect(callCount).toBe(2);
    expect(onInvoiceFailed).toHaveBeenCalledOnce();
    const failedList = payment.invoicing.getFailed();
    expect(failedList).toHaveLength(1);
    expect(failedList[0].paymentId).toBe('pay-err-1');
    expect(failedList[0].error).toContain('Gateway timeout');
  });

  it('allows manual retry of failed invoices', async () => {
    let attempt = 0;
    const createInvoice = vi.fn().mockImplementation(() => {
      attempt++;
      if (attempt === 1) {
        return Promise.reject(new Error('Temporary network error'));
      }
      return Promise.resolve({
        id: 'inv-recovered-456',
        invoiceNumber: 'EF202600000002',
        status: 'created',
      } satisfies InvoiceResult);
    });

    const mockAdapter: InvoicingAdapter = {
      name: 'mock-adapter',
      createInvoice,
    };

    const provider = new MockProvider();
    vi.spyOn(provider, 'createPayment').mockResolvedValue({
      status: PaymentStatus.SUCCESS,
      paymentId: 'pay-manual-retry',
    });

    const payment = betterPayment({
      providers: { mock: provider },
      defaultProvider: 'mock',
      plugins: [
        invoicing({
          adapter: mockAdapter,
          retry: { attempts: 1, delay: 0 },
        }),
      ],
    });

    await payment.createPayment(mockPaymentRequest);
    expect(payment.invoicing.get('pay-manual-retry')?.status).toBe('failed');

    const retriedInvoice = await payment.invoicing.retry('pay-manual-retry');
    expect(retriedInvoice.id).toBe('inv-recovered-456');
    expect(payment.invoicing.get('pay-manual-retry')?.status).toBe('created');
    expect(payment.invoicing.getFailed()).toHaveLength(0);
  });

  it('handles refund.succeeded by creating return invoice or cancelling', async () => {
    const cancelInvoice = vi.fn().mockResolvedValue(undefined);
    const mockAdapter: InvoicingAdapter = {
      name: 'mock-cancelling',
      createInvoice: vi.fn().mockResolvedValue({ id: 'inv-to-cancel', status: 'created' }),
      cancelInvoice,
    };

    const provider = new MockProvider();
    vi.spyOn(provider, 'createPayment').mockResolvedValue({
      status: PaymentStatus.SUCCESS,
      paymentId: 'pay-refundable',
    });
    vi.spyOn(provider, 'refund').mockResolvedValue({
      status: PaymentStatus.SUCCESS,
      paymentId: 'pay-refundable',
    });

    const payment = betterPayment({
      providers: { mock: provider },
      defaultProvider: 'mock',
      plugins: [
        invoicing({
          adapter: mockAdapter,
          onRefund: 'cancel',
        }),
      ],
    });

    await payment.createPayment(mockPaymentRequest);
    await payment.refund({ paymentId: 'pay-refundable', amount: '100.00' });

    expect(cancelInvoice).toHaveBeenCalledWith('inv-to-cancel');
  });

  describe('parasut adapter', () => {
    it('authenticates and calls sales_invoices endpoint with JSON:API structure', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/oauth/token')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              access_token: 'fake-jwt-token',
              expires_in: 7200,
            }),
          };
        }
        if (url.includes('/sales_invoices')) {
          return {
            ok: true,
            status: 201,
            json: async () => ({
              data: {
                id: '987654',
                type: 'sales_invoices',
                attributes: {
                  invoice_no: 'PRS202600000009',
                },
              },
            }),
          };
        }
        return { ok: false, status: 404, text: async () => 'Not found' };
      });

      const adapter = parasut({
        clientId: 'test-client',
        clientSecret: 'test-secret',
        companyId: '12345',
        fetch: mockFetch as any,
      });

      const result = await adapter.createInvoice({
        paymentId: 'pay-parasut-1',
        total: '150.00',
        buyer: { name: 'Ahmet Yilmaz', email: 'ahmet@example.com' },
        items: [{ name: 'Test Product', unitPrice: '150.00', quantity: 1 }],
      });

      expect(result.id).toBe('987654');
      expect(result.invoiceNumber).toBe('PRS202600000009');
      expect(mockFetch).toHaveBeenCalledTimes(2); // 1 token + 1 sales_invoices
    });
  });
});
