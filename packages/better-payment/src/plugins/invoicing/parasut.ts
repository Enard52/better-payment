import type { CreateInvoiceParams, InvoiceResult, InvoicingAdapter } from './types';

export interface ParasutOptions {
  clientId: string;
  clientSecret: string;
  companyId: string;
  username?: string;
  password?: string;
  baseUrl?: string;
  tokenUrl?: string;
  fetch?: typeof fetch;
}

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

export function parasut(options: ParasutOptions): InvoicingAdapter {
  const baseUrl = options.baseUrl ? options.baseUrl.replace(/\/+$/, '') : 'https://api.parasut.com';
  const tokenUrl = options.tokenUrl ?? `${baseUrl}/oauth/token`;
  const fetchFn = options.fetch ?? globalThis.fetch;

  let tokenCache: TokenCache | null = null;

  async function getAccessToken(): Promise<string> {
    const now = Date.now();
    if (tokenCache && tokenCache.expiresAt > now + 30_000) {
      return tokenCache.accessToken;
    }

    const bodyParams = new URLSearchParams();
    bodyParams.set('client_id', options.clientId);
    bodyParams.set('client_secret', options.clientSecret);

    if (options.username && options.password) {
      bodyParams.set('grant_type', 'password');
      bodyParams.set('username', options.username);
      bodyParams.set('password', options.password);
    } else {
      bodyParams.set('grant_type', 'client_credentials');
    }

    const res = await fetchFn(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: bodyParams.toString(),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Parasut OAuth failed (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as { access_token: string; expires_in: number };
    tokenCache = {
      accessToken: data.access_token,
      expiresAt: now + (data.expires_in ?? 7200) * 1000,
    };

    return tokenCache.accessToken;
  }

  interface ParasutInvoiceResponse {
    data?: {
      id?: string | number;
      type?: string;
      attributes?: {
        invoice_no?: string;
        [key: string]: unknown;
      };
      [key: string]: unknown;
    };
    [key: string]: unknown;
  }

  async function request(
    path: string,
    init: RequestInit = {}
  ): Promise<ParasutInvoiceResponse | null> {
    const token = await getAccessToken();
    const url = `${baseUrl}/v4/${options.companyId}${path}`;
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init.headers || {}),
    };

    const res = await fetchFn(url, { ...init, headers });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Parasut API error (${res.status}) on ${path}: ${errText}`);
    }

    if (res.status === 204) return null;
    return res.json();
  }

  return {
    name: 'parasut',

    async createInvoice(params: CreateInvoiceParams): Promise<InvoiceResult> {
      const issueDate = params.issueDate || new Date().toISOString().split('T')[0];
      const currency = params.currency || 'TRL';

      const detailsData = params.items.map((item) => ({
        type: 'sales_invoice_details',
        attributes: {
          quantity: item.quantity ?? 1,
          unit_price: Number(item.unitPrice),
          vat_rate: item.vatRate ?? params.vatRate ?? 20,
        },
      }));

      const payload = {
        data: {
          type: 'sales_invoices',
          attributes: {
            item_type: 'invoice',
            description: `Payment: ${params.paymentId || 'N/A'}${params.conversationId ? ` (Order: ${params.conversationId})` : ''}`,
            issue_date: issueDate,
            currency,
            net_total: Number(params.total),
          },
          relationships: {
            details: {
              data: detailsData,
            },
          },
        },
      };

      const response = await request('/sales_invoices', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      const invoiceId = response?.data?.id ?? `parasut-${Date.now()}`;
      const invoiceNumber = response?.data?.attributes?.invoice_no ?? `INV-${invoiceId}`;

      return {
        id: String(invoiceId),
        invoiceNumber,
        status: 'created',
        rawResponse: response,
      };
    },

    async cancelInvoice(invoiceId: string, reason?: string): Promise<void> {
      await request(`/sales_invoices/${invoiceId}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason || 'Order cancelled' }),
      });
    },

    async createReturnInvoice(
      invoiceId: string,
      params: CreateInvoiceParams
    ): Promise<InvoiceResult> {
      const issueDate = params.issueDate || new Date().toISOString().split('T')[0];
      const currency = params.currency || 'TRL';

      const detailsData = params.items.map((item) => ({
        type: 'sales_invoice_details',
        attributes: {
          quantity: item.quantity ?? 1,
          unit_price: Number(item.unitPrice),
          vat_rate: item.vatRate ?? params.vatRate ?? 20,
        },
      }));

      const payload = {
        data: {
          type: 'sales_invoices',
          attributes: {
            item_type: 'return',
            description: `Return for invoice ${invoiceId}: ${params.paymentId || ''}`,
            issue_date: issueDate,
            currency,
            net_total: Number(params.total),
          },
          relationships: {
            details: {
              data: detailsData,
            },
          },
        },
      };

      const response = await request('/sales_invoices', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      const returnInvoiceId = response?.data?.id ?? `parasut-return-${Date.now()}`;
      const invoiceNumber = response?.data?.attributes?.invoice_no ?? `RET-${returnInvoiceId}`;

      return {
        id: String(returnInvoiceId),
        invoiceNumber,
        status: 'created',
        rawResponse: response,
      };
    },
  };
}
