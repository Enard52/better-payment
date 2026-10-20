import type { PaymentProvider } from './PaymentProvider';
import type { PaymentResponse, RecurringPaymentRequest } from '../types';
import { BetterPaymentError, ValidationError } from './errors';

/**
 * Charge a stored card for a recurring billing period, without the cardholder
 * present (merchant-initiated transaction / card-on-file).
 *
 * One API for every provider that documents merchant-initiated stored-card
 * charges (`capabilities.recurring`); providers that do not document it throw
 * a `NOT_SUPPORTED` error instead of guessing a payload:
 * - iyzico: NON-3D payment with `cardUserKey` + `cardToken` and
 *   `paymentGroup: "SUBSCRIPTION"` — https://docs.iyzico.com/en/advanced/card-storage
 * - PayTR: Direct API with `utoken` + `ctoken`, `non_3d=1` and
 *   `recurring_payment=1` —
 *   https://dev.paytr.com/direkt-api/kart-saklama-api/kayitli-kart-tekrarlayan-odeme
 *
 * SAFETY — this helper NEVER retries anything:
 * A `NETWORK_ERROR` result (status `pending`) means the provider may already
 * have processed the charge. Re-executing it would double-charge the customer.
 * When the result is `pending`, query the order (`getPayment()`) or resubmit
 * later with the SAME `conversationId` — providers reject a duplicate order id
 * instead of charging twice. `addBillingPeriod()` + a per-period
 * `conversationId` (see the recurring-payments guide) make retries idempotent.
 *
 * The billing schedule itself stays with the caller: this library never starts
 * timers or cron jobs.
 */
export async function chargeStoredCard(
  provider: PaymentProvider,
  request: RecurringPaymentRequest
): Promise<PaymentResponse> {
  if (!provider.capabilities.recurring) {
    throw new BetterPaymentError(
      'Recurring payment with a stored card is not supported by this provider',
      'NOT_SUPPORTED'
    );
  }
  if (!request || typeof request !== 'object' || !request.storedCard) {
    throw new ValidationError('storedCard is required', undefined, [
      { path: 'storedCard', message: 'is required' },
    ]);
  }
  // The MIT indicator is not defaulted here either: it is part of the request
  // type, and provider validation rejects a stored-card charge without it.
  return provider.createPayment({ ...request, recurring: true });
}

/**
 * Adds whole billing months to a date, clamping to the end of shorter months:
 * 2026-01-31 + 1 month = 2026-02-28, 2024-01-31 + 1 month = 2024-02-29 (leap),
 * 2026-05-31 + 1 month = 2026-06-30. So a subscription anchored on the 31st
 * still bills every month. The input is not mutated.
 *
 * Returns a UTC-midnight Date so billing periods do not drift with DST or the
 * host timezone. Amounts are untouched here: prices stay decimal strings
 * (`price`/`paidPrice` on the request); never do float money maths.
 */
export function addBillingMonths(date: Date, months: number): Date {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new ValidationError('date must be a valid Date');
  }
  if (!Number.isInteger(months) || months < 0) {
    throw new ValidationError(`Invalid billing months: ${months}`);
  }
  const anchor = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const shifted = new Date(anchor);
  const day = shifted.getUTCDate();
  shifted.setUTCDate(1);
  shifted.setUTCMonth(shifted.getUTCMonth() + months);
  // Day 0 of the NEXT month is the last day of the target month
  const lastDay = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0))
    .getUTCDate();
  shifted.setUTCDate(Math.min(day, lastDay));
  return shifted;
}

/**
 * A stable order id for one billing period, e.g. `sub-42-2026-02`.
 * Reuse it when retrying the SAME period and change it only when you move to
 * the next one: a retry with the same id is rejected by the provider
 * (duplicate order) instead of double-charging.
 */
export function billingOrderId(base: string, periodStart: Date): string {
  if (!base || !/^[A-Za-z0-9_-]+$/.test(base)) {
    throw new ValidationError(`billingOrderId base must be alphanumeric: ${base}`);
  }
  const year = periodStart.getUTCFullYear();
  const month = String(periodStart.getUTCMonth() + 1).padStart(2, '0');
  return `${base}-${year}-${month}`;
}
