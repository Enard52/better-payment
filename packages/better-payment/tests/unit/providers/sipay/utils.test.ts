import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import {
  buildSipayItems,
  createSipayHashKey,
  createSipayPaymentHash,
  decryptSipayHashKey,
  formatSipayAmount,
  formatSipayExpiry,
  formatSipayInstallment,
  getSipayCurrency,
  getSipayLanguage,
  mapSipayTransactionStatus,
  parseSipayForm,
  verifySipayPaymentHash,
} from '../../../../src/providers/sipay/utils';
import { PaymentStatus } from '../../../../src/types';
import { mockBasketItems } from '../../../fixtures/payment-data';
import {
  SIPAY_3D_REJECTED_HTML,
  SIPAY_REFERENCE_HASH_KEY,
  SIPAY_REFERENCE_HASH_PLAIN,
  SIPAY_TEST,
} from '../../../fixtures/sipay';

const SECRET = SIPAY_TEST.appSecret;

/** Sipay's reference decryption (JavaScript sample of the "Hash Validation" page) */
function referenceDecrypt(hashKey: string, appSecret: string): string {
  const [iv, salt, encrypted] = decodeURIComponent(hashKey).replace(/__/g, '/').split(':');
  const password = crypto.createHash('sha1').update(appSecret).digest('hex');
  const key = crypto
    .createHash('sha256')
    .update(password + salt)
    .digest('hex')
    .slice(0, 32);
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(key), Buffer.from(iv));
  return decipher.update(encrypted, 'base64', 'utf8') + decipher.final('utf8');
}

describe('Sipay hash keys', () => {
  it('decrypts a hash key made by Sipay\u2019s reference code', async () => {
    expect((await decryptSipayHashKey(SIPAY_REFERENCE_HASH_KEY, SECRET))?.join('|')).toBe(
      SIPAY_REFERENCE_HASH_PLAIN
    );
  });

  it('creates hash keys that Sipay’s reference code decrypts', async () => {
    const hash = await createSipayPaymentHash(
      {
        total: '10.00',
        installment: 1,
        currency: 'TRY',
        merchantKey: SIPAY_TEST.merchantKey,
        invoiceId: 'INV1',
      },
      SECRET
    );
    expect(hash).toMatch(/^[0-9a-f]{16}:[0-9a-f]{4}:[A-Za-z0-9+_=]+$/);
    expect(hash).not.toContain('/');
    expect(referenceDecrypt(hash, SECRET)).toBe(`10.00|1|TRY|${SIPAY_TEST.merchantKey}|INV1`);
  });

  it('uses a new IV and salt for every hash key', async () => {
    const a = await createSipayHashKey(['x'], SECRET);
    const b = await createSipayHashKey(['x'], SECRET);
    expect(a).not.toBe(b);
    expect(await decryptSipayHashKey(a, SECRET)).toEqual(['x']);
  });

  it('accepts URL-encoded hash keys and "+" turned into spaces', async () => {
    expect(
      (await decryptSipayHashKey(encodeURIComponent(SIPAY_REFERENCE_HASH_KEY), SECRET))?.join('|')
    ).toBe(SIPAY_REFERENCE_HASH_PLAIN);
    expect(
      (await decryptSipayHashKey(SIPAY_REFERENCE_HASH_KEY.replace(/\+/g, ' '), SECRET))?.join('|')
    ).toBe(SIPAY_REFERENCE_HASH_PLAIN);
  });

  it.each([
    ['another secret', SIPAY_REFERENCE_HASH_KEY, 'not-the-secret'],
    ['a malformed value', 'abc', SECRET],
    ['a tampered ciphertext', SIPAY_REFERENCE_HASH_KEY.replace('J3v+', 'J3w+'), SECRET],
    ['an empty value', '', SECRET],
  ])('rejects %s', async (_label, hashKey, secret) => {
    expect(await decryptSipayHashKey(hashKey, secret)).toBeUndefined();
  });

  it('verifySipayPaymentHash returns the named fields', async () => {
    expect(await verifySipayPaymentHash(SIPAY_REFERENCE_HASH_KEY, SECRET)).toEqual({
      status: '1',
      total: '10.00',
      invoiceId: 'BP3D1791714553140',
      orderId: 'VP17917145548423635',
      currency: 'TRY',
    });
    expect(
      await verifySipayPaymentHash(await createSipayHashKey(['1', '2'], SECRET), SECRET)
    ).toBeUndefined();
  });
});

describe('Sipay formatting', () => {
  it('formats amounts with two decimals', () => {
    expect(formatSipayAmount('1')).toBe('1.00');
    expect(formatSipayAmount('1.2')).toBe('1.20');
    expect(formatSipayAmount(10.005)).toBe('10.01');
  });

  it('accepts TRY, USD, EUR and GBP', () => {
    expect(getSipayCurrency(undefined)).toBe('TRY');
    expect(getSipayCurrency('TL')).toBe('TRY');
    expect(getSipayCurrency('usd')).toBe('USD');
    expect(getSipayCurrency('GBP')).toBe('GBP');
    expect(() => getSipayCurrency('JPY')).toThrow('JPY');
  });

  it('formats expiry with a four-digit year', () => {
    expect(formatSipayExpiry('1', '30')).toEqual({ expiry_month: '01', expiry_year: '2030' });
    expect(formatSipayExpiry('12', '2031')).toEqual({ expiry_month: '12', expiry_year: '2031' });
    expect(() => formatSipayExpiry('13', '2030')).toThrow();
  });

  it('accepts 1 to 12 installments', () => {
    expect(formatSipayInstallment(undefined)).toBe(1);
    expect(formatSipayInstallment(0)).toBe(1);
    expect(formatSipayInstallment(6)).toBe(6);
    expect(() => formatSipayInstallment(13)).toThrow();
  });

  it('picks the language from the locale', () => {
    expect(getSipayLanguage('en-US')).toBe('en');
    expect(getSipayLanguage('tr')).toBe('tr');
    expect(getSipayLanguage(undefined)).toBe('tr');
  });
});

describe('buildSipayItems', () => {
  it('sends the basket when it adds up to the total', () => {
    expect(buildSipayItems(mockBasketItems, '1.00', 'Order X')).toEqual([
      { name: 'Binocular', price: '0.30', quantity: 1, description: 'Collectibles' },
      { name: 'Game code', price: '0.50', quantity: 1, description: 'Game' },
      { name: 'Usb', price: '0.20', quantity: 1, description: 'Electronics' },
    ]);
  });

  it('sends one item for the whole order when it does not', () => {
    expect(buildSipayItems(mockBasketItems, '1.20', 'Order X')).toEqual([
      { name: 'Order X', price: '1.20', quantity: 1, description: 'Order X' },
    ]);
    expect(buildSipayItems(undefined, '5.00', 'Order Y')).toHaveLength(1);
  });
});

describe('parseSipayForm', () => {
  it('reads the hidden inputs of a rejection form', () => {
    expect(parseSipayForm(SIPAY_3D_REJECTED_HTML)).toMatchObject({
      sipay_status: '0',
      invoice_id: 'ORDER3D',
      status_code: '68',
      status_description: 'Invalid hash key',
    });
  });

  it('decodes HTML entities', () => {
    expect(parseSipayForm('<input name="a&amp;b" value="&quot;x&#39;&#x3C;">')).toEqual({
      'a&b': `"x'<`,
    });
  });
});

describe('mapSipayTransactionStatus', () => {
  it.each([
    ['Completed', PaymentStatus.SUCCESS],
    ['Partial Refund', PaymentStatus.SUCCESS],
    ['Pre-Authorization', PaymentStatus.SUCCESS],
    ['Refunded', PaymentStatus.CANCELLED],
    ['Cancelled', PaymentStatus.CANCELLED],
    ['Failed', PaymentStatus.FAILURE],
    ['Pending', PaymentStatus.PENDING],
    [undefined, PaymentStatus.PENDING],
  ])('%s -> %s', (input, expected) => {
    expect(mapSipayTransactionStatus(input)).toBe(expected);
  });
});
