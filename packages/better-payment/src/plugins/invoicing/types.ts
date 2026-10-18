import type { BasketItem, Buyer, PaymentEvent } from 'better-payment';

export interface InvoiceBuyer {
  name: string;
  taxNumber?: string; // TCKN or VKN
  taxOffice?: string;
  email?: string;
  address?: string;
  city?: string;
  country?: string;
  phone?: string;
}

export interface InvoiceItem {
  name: string;
  quantity?: number;
  unitPrice: number | string;
  vatRate?: number; // e.g. 20 (percent)
}

export interface CreateInvoiceParams {
  paymentId?: string;
  conversationId?: string;
  buyer: InvoiceBuyer;
  items: InvoiceItem[];
  total: number | string;
  currency?: string;
  issueDate?: string;
  vatRate?: number;
}

export interface InvoiceResult {
  id: string;
  invoiceNumber?: string;
  pdfUrl?: string;
  status: 'created' | 'pending' | 'failed';
  rawResponse?: unknown;
}

export interface InvoicingAdapter {
  name: string;
  createInvoice(params: CreateInvoiceParams): Promise<InvoiceResult>;
  cancelInvoice?(invoiceId: string, reason?: string): Promise<void>;
  createReturnInvoice?(invoiceId: string, params: CreateInvoiceParams): Promise<InvoiceResult>;
}

export interface InvoicingMappedData {
  buyer?: Partial<InvoiceBuyer>;
  items?: InvoiceItem[];
  vatRate?: number;
  description?: string;
}

export type InvoicingMapFn = (payment: {
  buyer?: Buyer;
  basketItems?: BasketItem[];
  amount?: string;
  currency?: string;
  paymentId?: string;
  conversationId?: string;
  event: PaymentEvent<'payment.succeeded'>;
}) => InvoicingMappedData | Promise<InvoicingMappedData>;

export type InvoiceRefundAction = 'return-invoice' | 'cancel' | 'none';

export interface InvoicingRetryConfig {
  /** Maximum number of attempts. Default: 3 */
  attempts?: number;
  /** Delay in milliseconds between attempts. Default: 1000 */
  delay?: number;
}

export interface InvoicingOptions {
  /** The invoicing provider adapter (e.g. parasut) */
  adapter: InvoicingAdapter;
  /** Function to map payment data into invoice fields */
  map?: InvoicingMapFn;
  /**
   * Action to perform when a payment refund succeeds:
   * - 'return-invoice': issue a return/storno invoice
   * - 'cancel': cancel the original sales invoice
   * - 'none': do nothing
   * Default: 'return-invoice'
   */
  onRefund?: InvoiceRefundAction;
  /** Retry policy for transient API failures. Default: 3 attempts, 1s delay */
  retry?: InvoicingRetryConfig;
  /** Default VAT rate percentage (e.g. 20 for 20%). Default: 20 */
  defaultVatRate?: number;
  /** Hook called when an invoice is successfully created */
  onInvoiceCreated?: (
    invoice: InvoiceResult,
    event: PaymentEvent<'payment.succeeded'>
  ) => void | Promise<void>;
  /** Hook called when invoice creation fails after retries */
  onInvoiceFailed?: (
    error: Error,
    event: PaymentEvent<'payment.succeeded'>
  ) => void | Promise<void>;
}

export interface InvoicingRecord {
  paymentId: string;
  conversationId?: string;
  invoiceId?: string;
  invoiceNumber?: string;
  pdfUrl?: string;
  status: 'created' | 'pending' | 'failed';
  amount?: string;
  currency?: string;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}
