import {
  ConfigurationError,
  definePlugin,
  type BasketItem,
  type Buyer,
  type PaymentEvent,
  type PluginContext,
} from 'better-payment';
import type {
  CreateInvoiceParams,
  InvoiceItem,
  InvoiceResult,
  InvoicingOptions,
  InvoicingRecord,
} from './invoicing/types';

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const invoicing = (options: InvoicingOptions) => {
  if (!options?.adapter) {
    throw new ConfigurationError('invoicing: adapter is required');
  }

  const adapter = options.adapter;
  const attempts = options.retry?.attempts ?? 3;
  const delay = options.retry?.delay ?? 1000;
  const defaultVatRate = options.defaultVatRate ?? 20;
  const onRefund = options.onRefund ?? 'return-invoice';

  const records = new Map<string, InvoicingRecord>();
  let pluginCtx: PluginContext;

  async function executeWithRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let i = 1; i <= attempts; i++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        if (i < attempts && delay > 0) {
          await sleep(delay);
        }
      }
    }
    throw lastError;
  }

  async function handlePaymentSucceeded(event: PaymentEvent<'payment.succeeded'>) {
    const paymentId = event.paymentId || String(event.result && (event.result as Record<string, unknown>).paymentId) || `pay-${Date.now()}`;
    const conversationId = event.conversationId;
    const req = (event.request as Record<string, unknown>) || {};
    const buyerRaw = (req.buyer as Record<string, unknown>) || {};
    const basketItemsRaw = (req.basketItems as Array<Record<string, unknown>>) || [];
    const amount = event.amount || String(req.paidPrice || req.price || '0');
    const currency = event.currency || String(req.currency || 'TRY');

    const mapped = options.map
      ? await options.map({
          buyer: req.buyer as Buyer | undefined,
          basketItems: req.basketItems as BasketItem[] | undefined,
          amount,
          currency,
          paymentId,
          conversationId,
          event,
        })
      : {};

    const items: InvoiceItem[] = mapped.items || (basketItemsRaw.length > 0
      ? basketItemsRaw.map((b) => ({
          name: String(b.name || 'Product'),
          quantity: 1,
          unitPrice: b.price !== undefined ? String(b.price) : amount,
          vatRate: mapped.vatRate ?? defaultVatRate,
        }))
      : [
          {
            name: mapped.description || 'Payment',
            quantity: 1,
            unitPrice: amount,
            vatRate: mapped.vatRate ?? defaultVatRate,
          },
        ]);

    const params: CreateInvoiceParams = {
      paymentId,
      conversationId,
      buyer: {
        name: mapped.buyer?.name || `${buyerRaw.name || ''} ${buyerRaw.surname || ''}`.trim() || 'Valued Customer',
        taxNumber: mapped.buyer?.taxNumber || String(buyerRaw.identityNumber || ''),
        taxOffice: mapped.buyer?.taxOffice,
        email: mapped.buyer?.email || String(buyerRaw.email || ''),
        phone: mapped.buyer?.phone || String(buyerRaw.gsmNumber || ''),
        address: mapped.buyer?.address || String(buyerRaw.registrationAddress || ''),
        city: mapped.buyer?.city || String(buyerRaw.city || ''),
        country: mapped.buyer?.country || String(buyerRaw.country || 'Turkey'),
      },
      items,
      total: amount,
      currency,
      vatRate: mapped.vatRate ?? defaultVatRate,
    };

    try {
      const invoice = await executeWithRetry(() => adapter.createInvoice(params));
      const record: InvoicingRecord = {
        paymentId,
        conversationId,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        pdfUrl: invoice.pdfUrl,
        status: invoice.status,
        amount,
        currency,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      records.set(paymentId, record);
      if (options.onInvoiceCreated) {
        await options.onInvoiceCreated(invoice, event);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      pluginCtx?.logger?.error(`Invoicing failed for payment ${paymentId}`, err as Error);
      const record: InvoicingRecord = {
        paymentId,
        conversationId,
        status: 'failed',
        amount,
        currency,
        error: errorMsg,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      records.set(paymentId, record);
      if (options.onInvoiceFailed) {
        await options.onInvoiceFailed(err instanceof Error ? err : new Error(errorMsg), event);
      }
    }
  }

  async function handleRefundSucceeded(event: PaymentEvent<'refund.succeeded'>) {
    if (onRefund === 'none') return;

    const paymentId = event.paymentId || String(event.result && (event.result as Record<string, unknown>).paymentId);
    if (!paymentId) return;

    const record = records.get(paymentId);
    if (!record || !record.invoiceId) return;

    const req = (event.request as Record<string, unknown>) || {};
    const refundAmount = event.amount || String(req.refundPrice || req.price || record.amount || '0');

    try {
      if (onRefund === 'cancel' && adapter.cancelInvoice) {
        await executeWithRetry(() => adapter.cancelInvoice!(record.invoiceId!));
        record.status = 'failed';
        record.updatedAt = new Date();
      } else if (onRefund === 'return-invoice' && adapter.createReturnInvoice) {
        await executeWithRetry(() =>
          adapter.createReturnInvoice!(record.invoiceId!, {
            paymentId,
            conversationId: record.conversationId,
            buyer: { name: 'Customer' },
            items: [
              {
                name: 'Refund Return',
                quantity: 1,
                unitPrice: refundAmount,
                vatRate: defaultVatRate,
              },
            ],
            total: refundAmount,
            currency: record.currency,
          })
        );
        record.updatedAt = new Date();
      }
    } catch (err) {
      pluginCtx?.logger?.error(`Refund invoicing action failed for payment ${paymentId}`, err as Error);
    }
  }

  return definePlugin({
    id: 'invoicing',
    options,
    init: (ctx) => {
      pluginCtx = ctx;
    },
    events: {
      'payment.succeeded': (event) => handlePaymentSucceeded(event),
      'refund.succeeded': (event) => handleRefundSucceeded(event),
    },
    methods: () => ({
      invoicing: {
        get: (paymentId: string) => records.get(paymentId),
        list: () => [...records.values()],
        getFailed: () => [...records.values()].filter((r) => r.status === 'failed'),
        retry: async (paymentId: string): Promise<InvoiceResult> => {
          const record = records.get(paymentId);
          if (!record) {
            throw new Error(`invoicing: no record found for paymentId '${paymentId}'`);
          }
          const invoice = await executeWithRetry(() =>
            adapter.createInvoice({
              paymentId,
              conversationId: record.conversationId,
              buyer: { name: 'Customer' },
              items: [
                {
                  name: 'Invoice',
                  quantity: 1,
                  unitPrice: record.amount || '0',
                  vatRate: defaultVatRate,
                },
              ],
              total: record.amount || '0',
              currency: record.currency,
            })
          );
          record.invoiceId = invoice.id;
          record.invoiceNumber = invoice.invoiceNumber;
          record.pdfUrl = invoice.pdfUrl;
          record.status = invoice.status;
          record.error = undefined;
          record.updatedAt = new Date();
          return invoice;
        },
        cancel: async (paymentId: string, reason?: string): Promise<void> => {
          const record = records.get(paymentId);
          if (!record || !record.invoiceId) {
            throw new Error(`invoicing: no invoice found to cancel for paymentId '${paymentId}'`);
          }
          if (!adapter.cancelInvoice) {
            throw new Error(`invoicing: adapter '${adapter.name}' does not support cancelInvoice`);
          }
          await executeWithRetry(() => adapter.cancelInvoice!(record.invoiceId!, reason));
          record.status = 'failed';
          record.updatedAt = new Date();
        },
      },
    }),
  });
};
