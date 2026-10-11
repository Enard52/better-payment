import {
  aesCbcDecrypt,
  aesCbcEncrypt,
  base64ToBytes,
  digest,
  randomHex,
  toBase64,
  toHex,
} from '../../core/crypto';
import { ValidationError } from '../../core/errors';
import { formatDecimal, toMinorUnits } from '../../core/utils';
import { PaymentStatus, type BasketItem } from '../../types';
import type { SipayVerifiedHash } from './types';

/**
 * Sipay endpoints, relative to the provider base URL
 */
export const SIPAY_ENDPOINTS = {
  TOKEN: '/ccpayment/api/token',
  PAY_2D: '/ccpayment/api/paySmart2D',
  PAY_3D: '/ccpayment/api/paySmart3D',
  CHECK_STATUS: '/ccpayment/api/checkstatus',
  REFUND: '/ccpayment/api/refund',
  CONFIRM_PAYMENT: '/ccpayment/api/confirmPayment',
  GET_POS: '/ccpayment/api/getpos',
} as const;

/** Sipay's application status code for a successful request */
export const SIPAY_SUCCESS_CODE = 100;

/** confirmPayment `status`: capture or release a pre-authorization */
export const SIPAY_CONFIRM_STATUS = { CAPTURE: 1, VOID: 2 } as const;

async function sha1Hex(value: string): Promise<string> {
  return toHex(await digest('SHA-1', value));
}

async function sha256Hex(value: string): Promise<string> {
  return toHex(await digest('SHA-256', value));
}

/** AES-256 key: the first 32 hex characters of SHA-256(SHA-1(appSecret) + salt) */
async function hashKeyOf(appSecret: string, salt: string): Promise<string> {
  return (await sha256Hex((await sha1Hex(appSecret)) + salt)).slice(0, 32);
}

/**
 * Creates a Sipay hash key: the `|`-joined fields encrypted with AES-256-CBC,
 * sent as `iv:salt:ciphertext` with "/" written as "__".
 * A random IV and salt make every hash key different.
 */
export async function createSipayHashKey(fields: string[], appSecret: string): Promise<string> {
  const iv = randomHex(8);
  const salt = randomHex(2);
  const encrypted = await aesCbcEncrypt(await hashKeyOf(appSecret, salt), iv, fields.join('|'));
  return `${iv}:${salt}:${toBase64(encrypted)}`.replace(/\//g, '__');
}

/**
 * Decrypts a Sipay hash key into its `|`-separated fields.
 * Returns undefined when the hash key was not made with this app secret.
 */
export async function decryptSipayHashKey(
  hashKey: string | undefined,
  appSecret: string
): Promise<string[] | undefined> {
  if (!hashKey) return undefined;
  let value = hashKey.trim();
  // Accept a value that is still URL-encoded, or whose "+" a form parser turned into " "
  if (/%[0-9a-f]{2}/i.test(value)) {
    try {
      value = decodeURIComponent(value);
    } catch {
      return undefined;
    }
  }
  const [iv, salt, encrypted] = value.replace(/ /g, '+').replace(/__/g, '/').split(':');
  if (!iv || !salt || !encrypted || iv.length !== 16) return undefined;
  try {
    const plain = await aesCbcDecrypt(
      await hashKeyOf(appSecret, salt),
      iv,
      base64ToBytes(encrypted)
    );
    return new TextDecoder('utf-8', { fatal: true }).decode(plain).split('|');
  } catch {
    return undefined;
  }
}

/**
 * Verifies the hash key of a payment result (3D Secure callback, paySmart2D
 * response): `status|total|invoice_id|order_id|currency_code`
 */
export async function verifySipayPaymentHash(
  hashKey: string | undefined,
  appSecret: string
): Promise<SipayVerifiedHash | undefined> {
  const fields = await decryptSipayHashKey(hashKey, appSecret);
  if (!fields || fields.length < 5) return undefined;
  const [status, total, invoiceId, orderId, currency] = fields;
  return { status, total, invoiceId, orderId, currency };
}

/** Payment (paySmart2D, paySmart3D): total|installment|currency_code|merchant_key|invoice_id */
export function createSipayPaymentHash(
  fields: {
    total: string;
    installment: number;
    currency: string;
    merchantKey: string;
    invoiceId: string;
  },
  appSecret: string
): Promise<string> {
  return createSipayHashKey(
    [
      fields.total,
      String(fields.installment),
      fields.currency,
      fields.merchantKey,
      fields.invoiceId,
    ],
    appSecret
  );
}

/** checkstatus: invoice_id|merchant_key */
export function createSipayStatusHash(
  fields: { invoiceId: string; merchantKey: string },
  appSecret: string
): Promise<string> {
  return createSipayHashKey([fields.invoiceId, fields.merchantKey], appSecret);
}

/** refund: amount|invoice_id|merchant_key */
export function createSipayRefundHash(
  fields: { amount: string; invoiceId: string; merchantKey: string },
  appSecret: string
): Promise<string> {
  return createSipayHashKey([fields.amount, fields.invoiceId, fields.merchantKey], appSecret);
}

/** confirmPayment: merchant_key|invoice_id|status */
export function createSipayConfirmHash(
  fields: { merchantKey: string; invoiceId: string; status: number },
  appSecret: string
): Promise<string> {
  return createSipayHashKey(
    [fields.merchantKey, fields.invoiceId, String(fields.status)],
    appSecret
  );
}

/** Amount with two decimals, as sent and signed: 10 -> "10.00" */
export function formatSipayAmount(amount: string | number): string {
  return formatDecimal(amount);
}

/** Currency code: TRY, USD, EUR or GBP */
export function getSipayCurrency(currency: string | undefined): string {
  const code = (currency || 'TRY').toUpperCase();
  const normalized = code === 'TL' ? 'TRY' : code;
  if (!['TRY', 'USD', 'EUR', 'GBP'].includes(normalized)) {
    throw new ValidationError(`Currency ${currency} is not supported by Sipay`);
  }
  return normalized;
}

/** Installment count, 1 to 12 (1 for single payment) */
export function formatSipayInstallment(installment: number | undefined): number {
  const count = Math.max(1, installment ?? 1);
  if (!Number.isInteger(count) || count > 12) {
    throw new ValidationError(`Sipay supports 1 to 12 installments, got ${installment}`);
  }
  return count;
}

/** Card expiry as two-digit month and four-digit year ("01", "2030") */
export function formatSipayExpiry(
  month: string,
  year: string
): { expiry_month: string; expiry_year: string } {
  const mm = month.padStart(2, '0');
  const yyyy = year.length === 2 ? `20${year}` : year;
  if (!/^\d{2}$/.test(mm) || Number(mm) < 1 || Number(mm) > 12 || !/^\d{4}$/.test(yyyy)) {
    throw new ValidationError(`Invalid card expiry: ${month}/${year}`);
  }
  return { expiry_month: mm, expiry_year: yyyy };
}

export interface SipayItem {
  name: string;
  price: string;
  quantity: number;
  description: string;
}

/**
 * The `items` of a payment. Sipay rejects items whose prices do not add up to
 * `total`; when the basket does not (paidPrice includes interest or a discount
 * was applied), a single item for the whole order is sent instead.
 */
export function buildSipayItems(
  basketItems: BasketItem[] | undefined,
  total: string,
  description: string
): SipayItem[] {
  const items = (basketItems ?? []).map((item) => ({
    name: item.name,
    price: formatSipayAmount(item.price),
    quantity: 1,
    description: item.category1 || item.name,
  }));
  const sum = items.reduce((acc, item) => acc + toMinorUnits(item.price), 0);
  if (items.length > 0 && sum === toMinorUnits(total)) return items;
  return [{ name: description, price: total, quantity: 1, description }];
}

/** Language of Sipay's messages: "tr" or "en" */
export function getSipayLanguage(locale: string | undefined): 'tr' | 'en' {
  return (locale || 'tr').toLowerCase().startsWith('en') ? 'en' : 'tr';
}

const HTML_ENTITIES: Record<string, string> = {
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  amp: '&',
};

/** Decodes HTML entities in one pass, so decoded text is never decoded again */
function decodeHtml(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code[0] !== '#') return HTML_ENTITIES[code.toLowerCase()] ?? entity;
    const point =
      code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return point <= 0x10ffff ? String.fromCodePoint(point) : entity;
  });
}

/**
 * Hidden inputs of an HTML form. paySmart3D answers a rejected request with a
 * form that posts the error to cancel_url.
 */
export function parseSipayForm(html: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [tag] of html.matchAll(/<input\b[^>]*>/gi)) {
    const name = tag.match(/\bname\s*=\s*["']([^"']*)["']/i)?.[1];
    if (!name) continue;
    fields[decodeHtml(name)] = decodeHtml(tag.match(/\bvalue\s*=\s*["']([^"']*)["']/i)?.[1] ?? '');
  }
  return fields;
}

/**
 * checkstatus `transaction_status` to the unified status. A sale that was
 * partly refunded is still a success; a fully refunded or voided one is cancelled.
 * "Pre-Authorization" is an approved pre-authorization (the amount is blocked).
 */
export function mapSipayTransactionStatus(transactionStatus: string | undefined): PaymentStatus {
  switch ((transactionStatus || '').trim().toLowerCase()) {
    case 'completed':
    case 'partial refund':
    case 'partially_refund':
    case 'pre-authorization':
      return PaymentStatus.SUCCESS;
    case 'refunded':
    case 'refund':
    case 'cancelled':
    case 'canceled':
    case 'void':
      return PaymentStatus.CANCELLED;
    case 'failed':
    case 'fail':
      return PaymentStatus.FAILURE;
    default:
      return PaymentStatus.PENDING;
  }
}
