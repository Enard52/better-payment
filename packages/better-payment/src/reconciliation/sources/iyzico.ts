import { ConfigurationError, HttpClient, hmac, toBase64, toHex, randomHex } from 'better-payment';
import {
  ReconciliationError,
  addIsoDays,
  assertQueryRange,
  fieldsOf,
  mergeFieldCandidates,
  normalizeAmountString,
  normalizeCurrency,
  normalizeDate,
  pickRaw,
  pickString,
} from '../utils';
import type {
  ReconciliationFieldCandidates,
  ReconciliationQuery,
  ReconciliationSource,
  ReconciliationSourceOptions,
  ReconciledTransaction,
  ReconciliationTransactionStatus,
} from '../types';

/**
 * iyzico daily transactions via the official Reporting API.
 *
 * Official documentation: https://docs.iyzico.com/en/advanced/reporting-service
 * - GET https://api.iyzipay.com/v2/reporting/payment/transactions (sandbox:
 *   https://sandbox-api.iyzipay.com), query parameters `transactionDate`
 *   (YYYY-MM-DD, one day per request) and `page`; the response carries
 *   `transactions`, `currentPage` and `totalPageCount`.
 * - Row fields taken from the official SDK model:
 *   https://github.com/iyzico/iyzipay-dotnet/blob/main/Iyzipay/Model/V2/Transaction/TransactionReportItem.cs
 *   (transactionId, conversationId, price, paidPrice, transactionType,
 *   transactionCurrency, iyzicoFee, transactionDate, transactionStatus)
 * - Authorization: the same IYZWSv2 header as the payment API, documented at
 *   https://docs.iyzico.com/en/getting-started/preliminaries/authorization
 *   (HMAC-SHA256 of `randomString + uri + requestBody`, hex-encoded, then
 *   base64 of `apiKey:...&randomKey:...&signature:...`).
 *
 * Two things the public documentation does not settle, both configurable:
 * 1. What the GET request signs as "requestBody". iyzico's official PHP SDK
 *    (https://github.com/iyzico/iyzipay-php ReportingPaymentTransaction.php +
 *    IyziAuthV2Generator.php) signs the empty string; the official Node SDK
 *    (https://github.com/iyzico/iyzipay-node lib/utils.js) signs "{}". Default:
 *    "" (PHP behaviour). Set `signPayload: '{}'` if your account rejects it.
 * 2. The meaning of `transactionStatus` numbers: the reporting API returns the
 *    field but the public docs do not enumerate it. Rows whose status is not
 *    in `statusMap` are reported as `unknown`, never as success.
 */
export interface IyzicoReconciliationConfig extends ReconciliationSourceOptions {
  apiKey: string;
  secretKey: string;
  /** Default follows `mode`: https://api.iyzipay.com / https://sandbox-api.iyzipay.com */
  baseUrl?: string;
  mode?: 'sandbox' | 'production';
  /** Payload covered by the IYZWSv2 signature of the GET; default "" (see above) */
  signPayload?: string;
  /** `transactionStatus` value -> normalized status; default: {} (everything unknown) */
  statusMap?: Record<string, ReconciliationTransactionStatus>;
  /** First page number iyzico serves for your account. Default: 1. */
  firstPage?: number;
  /** Safety cap on page requests per day. Default: 100. */
  maxPages?: number;
}

const URI = '/v2/reporting/payment/transactions';

const DEFAULT_FIELDS: ReconciliationFieldCandidates = {
  transactionId: ['transactionId', 'itemTransactionId'],
  orderId: ['conversationId'],
  amount: ['price', 'paidPrice'],
  fee: ['iyzicoFee'],
  currency: ['transactionCurrency', 'currency'],
  date: ['transactionDate'],
  type: ['transactionType'],
  status: ['transactionStatus'],
};

function mapIyzicoType(value: string | undefined): ReconciledTransaction['type'] {
  switch ((value ?? '').toUpperCase()) {
    case 'PAYMENT':
      return 'sale';
    case 'REFUND':
      return 'refund';
    case 'CANCEL':
    case 'VOID':
    case 'REVERSAL':
      return 'void';
    case 'PAYOUT':
      return 'settlement';
    default:
      return 'other';
  }
}

async function iyzicoAuthHeader(
  apiKey: string,
  secretKey: string,
  randomString: string,
  uri: string,
  signPayload: string
): Promise<string> {
  const signature = toHex(await hmac('SHA-256', secretKey, randomString + uri + signPayload));
  return `IYZWSv2 ${toBase64(`apiKey:${apiKey}&randomKey:${randomString}&signature:${signature}`)}`;
}

export function iyzicoReconciliation(config: IyzicoReconciliationConfig): ReconciliationSource {
  const missing = (['apiKey', 'secretKey'] as const).filter((key) => !config[key]);
  if (missing.length > 0) {
    throw new ConfigurationError(
      `iyzicoReconciliation: configuration is missing: ${missing.join(', ')}`,
      'iyzico'
    );
  }
  const fields = mergeFieldCandidates(DEFAULT_FIELDS, config.fields);
  const baseUrl =
    config.baseUrl ??
    (config.mode === 'sandbox' ? 'https://sandbox-api.iyzipay.com' : 'https://api.iyzipay.com');
  const signPayload = config.signPayload ?? '';
  const firstPage = config.firstPage ?? 1;
  const maxPages = config.maxPages ?? 100;

  const client = new HttpClient({
    provider: 'iyzico-reconciliation',
    baseURL: baseUrl,
    timeout: config.timeoutMs ?? 30000,
    fetch: config.fetch,
    retry: config.retry,
  });

  const fetchPage = async (date: string, page: number): Promise<Record<string, unknown>> => {
    const randomString = randomHex(8);
    let authorization: string;
    try {
      authorization = await iyzicoAuthHeader(
        config.apiKey,
        config.secretKey,
        randomString,
        URI,
        signPayload
      );
    } catch (error) {
      throw new ReconciliationError('iyzico request signing failed', 'iyzico', { cause: error });
    }
    const url = `${URI}?transactionDate=${encodeURIComponent(`${date} 00:00:00`)}&page=${page}`;
    try {
      const response = await client.get<unknown>(url, {
        retryable: true,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: authorization,
          'x-iyzi-rnd': randomString,
        },
      });
      return fieldsOf(response.data);
    } catch (error) {
      throw new ReconciliationError('iyzico transaction list request failed', 'iyzico', {
        cause: error,
      });
    }
  };

  const listTransactions = async (
    query: ReconciliationQuery
  ): Promise<ReconciledTransaction[]> => {
    const { from, to } = assertQueryRange(query, 'iyzico');
    const out: ReconciledTransaction[] = [];
    const seen = new Set<string>();

    // iyzico's transactions feed is one day per request.
    for (let date = from; ; date = addIsoDays(date, 1)) {
      for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
        const page = firstPage + pageIndex;
        const body = await fetchPage(date, page);
        const rows = Array.isArray(body.transactions) ? body.transactions : [];
        const totalPageCount = Number(body.totalPageCount ?? firstPage) || firstPage;
        const currentPage = Number(body.currentPage ?? page) || page;

        for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
          const row = fieldsOf(rows[rowIndex]);
          const currency = normalizeCurrency(pickString(row, fields.currency));
          const amount = normalizeAmountString(
            pickRaw(row, fields.amount),
            currency,
            config.currencyDecimals
          );
          if (amount === undefined) continue;
          const fee = normalizeAmountString(
            pickRaw(row, fields.fee),
            currency,
            config.currencyDecimals
          );
          const orderId = pickString(row, fields.orderId);
          const transactionId =
            pickString(row, fields.transactionId) ??
            `iyzico|${date}|${orderId ?? ''}|${amount}|${rowIndex}`;
          if (seen.has(transactionId)) continue;
          seen.add(transactionId);
          const type = mapIyzicoType(pickString(row, fields.type));
          const statusValue = pickString(row, fields.status);
          const status: ReconciledTransaction['status'] =
            statusValue !== undefined && config.statusMap?.[statusValue]
              ? config.statusMap[statusValue]
              : statusValue !== undefined
                ? 'unknown'
                : // No status column at all: treat the listed row as confirmed —
                  // presence in iyzico's own transaction feed is the provider record.
                  'success';
          out.push({
            provider: 'iyzico',
            transactionId,
            ...(orderId !== undefined ? { orderId } : {}),
            type,
            amount,
            ...(fee !== undefined ? { fee } : {}),
            currency,
            status,
            date: normalizeDate(pickString(row, fields.date), date) ?? date,
          });
        }

        if (rows.length === 0 || currentPage >= totalPageCount) break;
      }
      if (date === to) break;
    }
    return out;
  };

  return { provider: 'iyzico', listTransactions };
}
