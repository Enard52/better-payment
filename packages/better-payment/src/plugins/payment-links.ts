import {
  definePlugin,
  ConfigurationError,
  type BetterPaymentPlugin,
  type EndpointContext,
  type PaymentRequest,
  type PaymentResponse,
  type Buyer,
  type Address,
  type PaymentCard,
} from 'better-payment';
import { hmac, toHex, safeEqual, randomHex } from '../core/crypto';
import { parseAmount, formatDecimal } from '../core/utils';

export type PaymentLinkStatus = 'open' | 'paid' | 'expired' | 'cancelled';

export interface PaymentLink {
  id: string;
  amount: string;
  currency: string;
  description?: string;
  url: string;
  signature: string;
  createdAt: number;
  expiresAt?: number;
  status: PaymentLinkStatus;
  singleUse: boolean;
  useCount: number;
  paidAt?: number;
  paymentId?: string;
  conversationId?: string;
  metadata?: Record<string, unknown>;
}

export interface CreatePaymentLinkOptions {
  id?: string;
  amount: string | number;
  currency?: string;
  description?: string;
  expiresIn?: number | string | Date;
  singleUse?: boolean;
  conversationId?: string;
  metadata?: Record<string, unknown>;
}

export interface PaymentLinkStore {
  get(id: string): Promise<PaymentLink | undefined> | PaymentLink | undefined;
  set(link: PaymentLink): Promise<void> | void;
  update(id: string, patch: Partial<PaymentLink>): Promise<PaymentLink | undefined> | PaymentLink | undefined;
}

export class MemoryPaymentLinkStore implements PaymentLinkStore {
  private readonly items = new Map<string, PaymentLink>();

  async get(id: string): Promise<PaymentLink | undefined> {
    return this.items.get(id);
  }

  async set(link: PaymentLink): Promise<void> {
    this.items.set(link.id, link);
  }

  async update(id: string, patch: Partial<PaymentLink>): Promise<PaymentLink | undefined> {
    const existing = this.items.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...patch };
    this.items.set(id, updated);
    return updated;
  }
}

export interface PaymentLinksOptions {
  /** Secret key used to generate and verify HMAC signatures on links */
  secret: string;
  /**
   * Base URL where the pay page / endpoints are mounted, e.g. `'https://shop.example.com/api/payment'`.
   */
  baseUrl: string;
  /** Storage backend for links. Defaults to in-memory store */
  store?: PaymentLinkStore;
  /** Default expiration duration (e.g. `'7d'`, `'24h'`, or ms). Defaults to `'7d'` */
  defaultExpiresIn?: number | string;
}

const DURATION_UNITS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

function parseDuration(val: number | string | Date | undefined, fallback: number): number {
  if (val === undefined) return fallback;
  if (val instanceof Date) return val.getTime() - Date.now();
  if (typeof val === 'number') return val;
  const match = /^(\d+(?:\.\d+)?)\s*(s|m|h|d)$/i.exec(val.trim());
  if (!match) {
    throw new ConfigurationError(`paymentLinks: invalid duration '${val}'. Use milliseconds or '60s', '24h', '7d'.`);
  }
  return Number(match[1]) * DURATION_UNITS[match[2].toLowerCase()];
}

export function paymentLinks(options: PaymentLinksOptions): BetterPaymentPlugin {
  if (!options.secret || typeof options.secret !== 'string') {
    throw new ConfigurationError('paymentLinks: a secret string is required');
  }
  if (!options.baseUrl || typeof options.baseUrl !== 'string') {
    throw new ConfigurationError('paymentLinks: baseUrl string is required');
  }

  const store = options.store ?? new MemoryPaymentLinkStore();
  const cleanBaseUrl = options.baseUrl.replace(/\/$/, '');
  const defaultDurationMs = parseDuration(options.defaultExpiresIn, 7 * 24 * 60 * 60 * 1000);

  async function computeSignature(
    id: string,
    amount: string,
    currency: string,
    expiresAt: number | undefined,
    singleUse: boolean
  ): Promise<string> {
    const payload = `${id}:${amount}:${currency}:${expiresAt ?? 0}:${singleUse ? 1 : 0}`;
    const hash = await hmac('SHA-256', options.secret, payload);
    return toHex(hash);
  }

  async function verifySignature(link: PaymentLink): Promise<boolean> {
    const expected = await computeSignature(
      link.id,
      link.amount,
      link.currency,
      link.expiresAt,
      link.singleUse
    );
    return safeEqual(link.signature, expected);
  }

  function checkStatus(link: PaymentLink): PaymentLinkStatus {
    if (link.status === 'cancelled' || link.status === 'paid') {
      return link.status;
    }
    if (link.expiresAt && Date.now() > link.expiresAt) {
      return 'expired';
    }
    return link.status;
  }

  return definePlugin({
    id: 'payment-links',
    version: '0.12.0',
    options,

    endpoints: {
      resolve: {
        method: 'GET',
        path: '/links/resolve',
        handler: async (ctx: EndpointContext) => {
          const id = ctx.query.get('id');
          if (!id) {
            return ctx.json({ error: true, message: 'Missing link id' }, 400);
          }

          const link = await store.get(id);
          if (!link) {
            return ctx.json({ error: true, message: 'Payment link not found' }, 404);
          }

          const status = checkStatus(link);
          const isValid = await verifySignature(link);
          if (!isValid) {
            return ctx.json({ error: true, message: 'Invalid payment link signature' }, 400);
          }

          return {
            id: link.id,
            amount: link.amount,
            currency: link.currency,
            description: link.description,
            status,
            expiresAt: link.expiresAt,
            singleUse: link.singleUse,
          };
        },
      },
      pay: {
        method: 'POST',
        path: '/links/pay',
        handler: async (ctx: EndpointContext) => {
          const body = ctx.body;
          const linkId = typeof body?.linkId === 'string' ? body.linkId : undefined;
          if (!linkId) {
            return ctx.json({ error: true, message: 'Missing linkId' }, 400);
          }

          const link = await store.get(linkId);
          if (!link) {
            return ctx.json({ error: true, message: 'Payment link not found' }, 404);
          }

          const status = checkStatus(link);
          if (status === 'expired') {
            return ctx.json({ error: true, message: 'This payment link has expired' }, 410);
          }
          if (status === 'paid' && link.singleUse) {
            return ctx.json({ error: true, message: 'This payment link has already been paid' }, 410);
          }
          if (status === 'cancelled') {
            return ctx.json({ error: true, message: 'This payment link was cancelled' }, 410);
          }

          const isValid = await verifySignature(link);
          if (!isValid) {
            return ctx.json({ error: true, message: 'Invalid link signature' }, 400);
          }

          const provider =
            typeof body?.provider === 'string' && ctx.providerIds.includes(body.provider)
              ? body.provider
              : ctx.defaultProvider ?? ctx.providerIds[0];

          if (!provider) {
            return ctx.json({ error: true, message: 'No payment provider available' }, 500);
          }

          const target = ctx.use(provider);
          const paymentRequest: PaymentRequest = {
            price: link.amount,
            paidPrice: link.amount,
            currency: link.currency,
            basketId: `LINK_${link.id}`,
            conversationId: link.conversationId || `LINK_${link.id}_${Date.now()}`,
            buyer: body?.buyer as unknown as Buyer,
            shippingAddress: body?.shippingAddress as unknown as Address,
            billingAddress: body?.billingAddress as unknown as Address,
            paymentCard: body?.paymentCard as unknown as PaymentCard,
            basketItems: [
              {
                id: link.id,
                name: link.description || `Payment link ${link.id}`,
                category1: 'General',
                itemType: 'VIRTUAL',
                price: link.amount,
              },
            ],
          };

          const result: PaymentResponse = await target.createPayment(paymentRequest);

          if (result.status === 'success') {
            const nextCount = link.useCount + 1;
            const nextStatus: PaymentLinkStatus = link.singleUse ? 'paid' : 'open';
            await store.update(link.id, {
              status: nextStatus,
              useCount: nextCount,
              paidAt: Date.now(),
              paymentId: result.paymentId,
            });
          }

          return result;
        },
      },
    },

    methods: () => ({
      links: {
        create: async (opts: CreatePaymentLinkOptions): Promise<PaymentLink> => {
          const numAmount = parseAmount(opts.amount, 'amount');
          const amountStr = formatDecimal(numAmount);
          const currency = (opts.currency || 'TRY').toUpperCase();
          const id = opts.id || randomHex(8);
          const singleUse = opts.singleUse !== false;

          let expiresAt: number | undefined;
          if (opts.expiresIn !== undefined) {
            const duration = parseDuration(opts.expiresIn, defaultDurationMs);
            expiresAt = Date.now() + duration;
          } else if (defaultDurationMs > 0) {
            expiresAt = Date.now() + defaultDurationMs;
          }

          const signature = await computeSignature(id, amountStr, currency, expiresAt, singleUse);
          const url = `${cleanBaseUrl}/links/resolve?id=${id}&sig=${signature}`;

          const link: PaymentLink = {
            id,
            amount: amountStr,
            currency,
            description: opts.description,
            url,
            signature,
            createdAt: Date.now(),
            expiresAt,
            status: 'open',
            singleUse,
            useCount: 0,
            conversationId: opts.conversationId,
            metadata: opts.metadata,
          };

          await store.set(link);
          return link;
        },

        get: async (id: string): Promise<PaymentLink | undefined> => {
          const link = await store.get(id);
          if (!link) return undefined;
          const status = checkStatus(link);
          if (status !== link.status) {
            await store.update(id, { status });
            link.status = status;
          }
          return link;
        },

        cancel: async (id: string): Promise<PaymentLink | undefined> => {
          return store.update(id, { status: 'cancelled' });
        },

        verify: async (link: PaymentLink): Promise<boolean> => {
          return verifySignature(link);
        },
      },
    }),
  });
}
