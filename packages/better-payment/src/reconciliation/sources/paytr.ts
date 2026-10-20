import { ConfigurationError, HttpClient } from 'better-payment';
import {
  ReconciliationError,
  assertQueryRange,
  chunkIsoRange,
  fieldsOf,
  foldTurkish,
  mergeFieldCandidates,
  normalizeAmountString,
  normalizeCurrency,
  normalizeDate,
  pickRaw,
  pickString,
  signHmacBase64Sha256,
} from '../utils';
import type {
  ReconciliationFieldCandidates,
  ReconciliationQuery,
  ReconciliationSource,
  ReconciliationSourceOptions,
  ReconciledTransaction,
} from '../types';

/**
 * PayTR daily transaction list via the resmi İşlem Dökümü report.
 *
 * Official documentation:
 * - Endpoint, parameters and response fields: https://dev.paytr.com/en/islem-dokumu
 *   (POST https://www.paytr.com/rapor/islem-dokumu, form fields merchant_id,
 *   start_date, end_date, paytr_token; at most 3 days per request)
 * - Token formula verified against PayTR's official Postman collection
 *   (https://github.com/paytr/paytr-postman, "İşlem Dökümü" pre-request script):
 *   paytr_token = base64(HMAC-SHA256(merchant_id + start_date + end_date +
 *   merchant_salt, merchant_key))
 *
 * Not verifiable without a PayTR sandbox report account (the issue's provider
 * credentials are payment keys; the report shares them, but no test merchant
 * exists): the documented response row fields are
 * islem_tipi / islem_tutari / odeme_tutari / kesinti_tutari / islem_tarihi /
 * para_birimi / siparis_no, and the docs do not show a wrapper object or a
 * unique transaction id per row. Rows are therefore read through configurable
 * `fields`, the rows array is looked up at `data` (or the top-level array), and
 * the transaction id falls back to a deterministic composite of the documented
 * row fields.
 */
export interface PayTRReconciliationConfig extends ReconciliationSourceOptions {
  merchantId: string;
  merchantKey: string;
  merchantSalt: string;
  /** Default: https://www.paytr.com (PayTR has a single host for reports) */
  baseUrl?: string;
}

const DEFAULT_FIELDS: ReconciliationFieldCandidates = {
  transactionId: ['referans_no', 'reference_no', 'islem_no', 'id'],
  orderId: ['siparis_no', 'merchant_oid', 'order_id'],
  amount: ['odeme_tutari', 'islem_tutari', 'net_tutar'],
  fee: ['kesinti_tutari'],
  currency: ['para_birimi', 'currency'],
  date: ['islem_tarihi', 'tarih'],
  type: ['islem_tipi'],
  status: ['durum', 'status'],
};

function mapPayTRType(value: string | undefined): ReconciledTransaction['type'] {
  if (value === undefined) return 'sale';
  const v = foldTurkish(value);
  if (v.includes('iade')) return 'refund';
  if (v.includes('iptal')) return 'void';
  if (v.includes('sat') || v.includes('odeme') || v.includes('payment')) return 'sale';
  return 'other';
}

function rowsOf(body: unknown): unknown[] {
  const root = fieldsOf(body);
  if (Array.isArray(root.data)) return root.data;
  if (Array.isArray(body)) return body as unknown[];
  return [];
}

export function paytrReconciliation(config: PayTRReconciliationConfig): ReconciliationSource {
  const missing = (['merchantId', 'merchantKey', 'merchantSalt'] as const).filter(
    (key) => !config[key]
  );
  if (missing.length > 0) {
    throw new ConfigurationError(
      `paytrReconciliation: configuration is missing: ${missing.join(', ')}`,
      'paytr'
    );
  }
  const fields = mergeFieldCandidates(DEFAULT_FIELDS, config.fields);
  const maxDays = config.maxDaysPerRequest ?? 3; // PayTR: "en fazla 3 gün" per request

  const client = new HttpClient({
    provider: 'paytr-reconciliation',
    baseURL: config.baseUrl ?? 'https://www.paytr.com',
    timeout: config.timeoutMs ?? 30000,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    fetch: config.fetch,
    retry: config.retry,
  });

  const listTransactions = async (
    query: ReconciliationQuery
  ): Promise<ReconciledTransaction[]> => {
    const { from, to } = assertQueryRange(query, 'paytr');
    const out: ReconciledTransaction[] = [];
    const seen = new Set<string>();

    for (const window of chunkIsoRange(from, to, maxDays)) {
      const startDate = `${window.start} 00:00:00`;
      const endDate = `${window.end} 23:59:59`;
      const token = await signHmacBase64Sha256(
        config.merchantId + startDate + endDate + config.merchantSalt,
        config.merchantKey
      );
      const form = new URLSearchParams({
        merchant_id: config.merchantId,
        start_date: startDate,
        end_date: endDate,
        paytr_token: token,
      });

      let body: unknown;
      try {
        const response = await client.post<unknown>('/rapor/islem-dokumu', form.toString(), {
          retryable: true,
        });
        body = response.data;
      } catch (error) {
        throw new ReconciliationError('PayTR transaction list request failed', 'paytr', {
          cause: error,
        });
      }

      const root = fieldsOf(body);
      if (root.status !== undefined && root.status !== 'success') {
        // Only error codes travel into the message: bodies carry order data.
        throw new ReconciliationError(
          `PayTR report failed (${pickString(root, ['err_no', 'error_code']) ?? 'unknown error'})`,
          'paytr'
        );
      }

      for (const rawRow of rowsOf(body)) {
        const row = fieldsOf(rawRow);
        const orderId = pickString(row, fields.orderId);
        const currency = normalizeCurrency(pickString(row, fields.currency));
        const amount = normalizeAmountString(pickRaw(row, fields.amount), currency, config.currencyDecimals);
        if (amount === undefined) continue; // a row without an amount cannot be reconciled
        const fee = normalizeAmountString(pickRaw(row, fields.fee), currency, config.currencyDecimals);
        const type = mapPayTRType(pickString(row, fields.type));
        const statusField = pickString(row, fields.status);
        const foldedStatus = statusField === undefined ? undefined : foldTurkish(statusField);
        const status: ReconciledTransaction['status'] =
          foldedStatus === undefined
            ? // The İşlem Dökümü lists processed sales and refunds; without a
              // status column the row is reported as unconfirmed on purpose.
              'unknown'
            : /basarisiz|hata|fail/i.test(foldedStatus)
              ? 'failure'
              : /basarili|success|odendi/i.test(foldedStatus)
                ? 'success'
                : 'unknown';
        const transactionId =
          pickString(row, fields.transactionId) ??
          // Deterministic composite so the same row re-delivered by two 3-day
          // windows (or pages) dedupes to one entry.
          `paytr|${orderId ?? ''}|${pickString(row, fields.date) ?? ''}|${pickString(row, fields.type) ?? ''}|${amount}`;
        const key = `${transactionId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          provider: 'paytr',
          transactionId,
          ...(orderId !== undefined ? { orderId } : {}),
          type,
          amount,
          ...(fee !== undefined ? { fee } : {}),
          currency,
          status,
          date: normalizeDate(pickString(row, fields.date), window.start) ?? window.start,
        });
      }
    }
    return out;
  };

  return { provider: 'paytr', listTransactions };
}
