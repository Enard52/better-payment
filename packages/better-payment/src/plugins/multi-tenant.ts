import {
  ConfigurationError,
  definePlugin,
  type BetterPaymentPlugin,
  type CancelRequest,
  type CancelResponse,
  type OperationContext,
  type PaymentOperation,
  type PaymentProvider,
  type PaymentRequest,
  type PaymentResponse,
  type PluginContext,
  type RefundRequest,
  type RefundResponse,
  type ThreeDSInitResponse,
  type ThreeDSPaymentRequest,
} from 'better-payment';
import type {
  CaptureRequest,
  DeleteCardRequest,
  DeleteCardResponse,
  InstallmentInfoRequest,
  InstallmentInfoResponse,
  ListCardsResponse,
  SaveCardRequest,
  SaveCardResponse,
  VoidAuthorizationRequest,
} from '../types';

export interface TenantContext {
  operation?: PaymentOperation;
  provider?: string;
  request?: unknown;
  headers?: Record<string, string>;
  conversationId?: string;
}

export type TenantResolver = (
  ctx: TenantContext
) => string | undefined | Promise<string | undefined>;

export type TenantCredentialsResolver = (
  tenantId: string,
  provider: string
) => Promise<PaymentProvider | Record<string, unknown>> | PaymentProvider | Record<string, unknown>;

export interface MultiTenantOptions {
  /**
   * Resolves the tenant ID from the operation request, headers, or metadata.
   * By default, checks `request.__tenantId`, `request.tenantId`, `request.metadata.tenantId`,
   * or a `tenant:` prefix in `conversationId`.
   */
  tenant?: TenantResolver;
  /**
   * Loads the provider instance or provider credentials for a given tenant.
   */
  credentials: TenantCredentialsResolver;
  /**
   * Optional provider factory mapping to instantiate providers from raw credentials.
   */
  providers?: Record<string, (credentials: Record<string, unknown>) => PaymentProvider>;
  /**
   * In-memory cache configuration for tenant provider instances.
   */
  cache?: {
    /**
     * Cache TTL in milliseconds or duration string (e.g. '5m', '1h', 300000).
     * Default: '5m' (300,000 ms).
     */
    ttl?: number | string;
    /**
     * Maximum number of cached tenant provider instances. Default: 1000.
     */
    maxSize?: number;
  };
}

interface CacheEntry {
  provider: PaymentProvider;
  expiresAt: number;
}

function parseDuration(val: number | string | undefined, defaultMs: number): number {
  if (val === undefined) return defaultMs;
  if (typeof val === 'number') return val;
  const match = val.trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$/i);
  if (!match) return defaultMs;
  const num = parseFloat(match[1]);
  const unit = (match[2] || 'ms').toLowerCase();
  switch (unit) {
    case 's':
      return num * 1000;
    case 'm':
      return num * 60 * 1000;
    case 'h':
      return num * 3600 * 1000;
    case 'd':
      return num * 86400 * 1000;
    default:
      return num;
  }
}

function extractTenantFromRequest(req: unknown): string | undefined {
  if (!req || typeof req !== 'object') return undefined;
  const obj = req as Record<string, unknown>;
  if (typeof obj.__tenantId === 'string') return obj.__tenantId;
  if (typeof obj.tenantId === 'string') return obj.tenantId;

  if (obj.metadata && typeof obj.metadata === 'object') {
    const meta = obj.metadata as Record<string, unknown>;
    if (typeof meta.tenantId === 'string') return meta.tenantId;
  }

  if (typeof obj.conversationId === 'string') {
    const cid = obj.conversationId;
    if (cid.startsWith('tenant:')) {
      const parts = cid.split(':');
      return parts[1];
    }
    if (cid.includes('::')) {
      return cid.split('::')[0];
    }
  }

  return undefined;
}

export interface TenantPaymentClient {
  readonly tenantId: string;
  createPayment(request: PaymentRequest): Promise<PaymentResponse>;
  initThreeDSPayment(request: ThreeDSPaymentRequest): Promise<ThreeDSInitResponse>;
  completeThreeDSPayment(request: unknown): Promise<PaymentResponse>;
  authorize(request: PaymentRequest): Promise<PaymentResponse>;
  initThreeDSAuthorize(request: ThreeDSPaymentRequest): Promise<ThreeDSInitResponse>;
  capture(request: CaptureRequest): Promise<PaymentResponse>;
  voidAuthorization(request: VoidAuthorizationRequest): Promise<CancelResponse>;
  refund(request: RefundRequest): Promise<RefundResponse>;
  cancel(request: CancelRequest): Promise<CancelResponse>;
  getPayment(paymentId: string, provider?: string): Promise<PaymentResponse>;
  saveCard(request: SaveCardRequest): Promise<SaveCardResponse>;
  listCards(request: { customerToken: string }): Promise<ListCardsResponse>;
  deleteCard(request: DeleteCardRequest): Promise<DeleteCardResponse>;
  binCheck(bin: string, provider?: string): Promise<unknown>;
  installmentInfo(request: InstallmentInfoRequest): Promise<InstallmentInfoResponse>;
}

/**
 * Multi-tenant plugin for better-payment.
 *
 * Dynamically resolves provider credentials per tenant / merchant on multi-tenant
 * SaaS and marketplace platforms, caching instances and routing 3D Secure callbacks
 * seamlessly to the correct tenant contract.
 *
 * @example
 * ```ts
 * import { multiTenant } from 'better-payment/plugins';
 *
 * const payment = betterPayment({
 *   providers: { iyzico: iyzico({ ... }) },
 *   plugins: [
 *     multiTenant({
 *       tenant: (ctx) => ctx.headers?.['x-tenant-id'] ?? ctx.request?.metadata?.tenantId,
 *       credentials: async (tenantId) => db.merchant.findCredentials(tenantId),
 *       cache: { ttl: '5m' },
 *     }),
 *   ],
 * });
 *
 * await payment.forTenant('shop-42').createPayment({ ... });
 * ```
 */
export function multiTenant(options: MultiTenantOptions): BetterPaymentPlugin {
  if (typeof options.credentials !== 'function') {
    throw new ConfigurationError('multiTenant: credentials function is required');
  }

  const ttl = parseDuration(options.cache?.ttl, 5 * 60 * 1000);
  const maxSize = options.cache?.maxSize ?? 1000;
  const cache = new Map<string, CacheEntry>();
  let pluginCtx: PluginContext;

  const getTenantProvider = async (
    tenantId: string,
    providerId: string
  ): Promise<PaymentProvider> => {
    const cacheKey = `${tenantId}:${providerId}`;
    const now = Date.now();

    if (ttl > 0) {
      const cached = cache.get(cacheKey);
      if (cached && now < cached.expiresAt) {
        return cached.provider;
      }
    }

    const resolved = await options.credentials(tenantId, providerId);
    let providerInstance: PaymentProvider;

    if (
      resolved &&
      typeof resolved === 'object' &&
      typeof (resolved as Record<string, unknown>).createPayment === 'function'
    ) {
      providerInstance = resolved as PaymentProvider;
    } else if (
      options.providers &&
      typeof options.providers[providerId] === 'function' &&
      resolved &&
      typeof resolved === 'object'
    ) {
      providerInstance = options.providers[providerId](resolved as Record<string, unknown>);
    } else {
      throw new ConfigurationError(
        `multiTenant: could not resolve a valid PaymentProvider for tenant '${tenantId}' on provider '${providerId}'`
      );
    }

    if (ttl > 0) {
      if (cache.size >= maxSize) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey) cache.delete(oldestKey);
      }
      cache.set(cacheKey, { provider: providerInstance, expiresAt: now + ttl });
    }

    return providerInstance;
  };

  const resolveTenantId = async (ctx: OperationContext): Promise<string | undefined> => {
    if (options.tenant) {
      const reqObj = ctx.request as Record<string, unknown> | undefined;
      const conversationId =
        reqObj && typeof reqObj.conversationId === 'string' ? reqObj.conversationId : undefined;
      const t = await options.tenant({
        operation: ctx.operation,
        provider: ctx.provider,
        request: ctx.request,
        conversationId,
      });
      if (t) return t;
    }
    return extractTenantFromRequest(ctx.request);
  };

  const createTenantClient = (tenantId: string): TenantPaymentClient => {
    const resolveProvider = (reqProvider?: string) => {
      return (
        reqProvider ??
        pluginCtx.defaultProvider ??
        (pluginCtx.providerIds.length > 0 ? pluginCtx.providerIds[0] : 'default')
      );
    };

    const attachTenant = <T>(res: T): T => {
      if (res && typeof res === 'object') {
        ((res as unknown) as Record<string, unknown>).tenantId = tenantId;
      }
      return res;
    };

    return {
      tenantId,
      createPayment: async (req) => {
        const p = await getTenantProvider(
          tenantId,
          resolveProvider(((req as unknown) as { provider?: string }).provider)
        );
        return attachTenant(await p.createPayment(req));
      },
      initThreeDSPayment: async (req) => {
        const p = await getTenantProvider(
          tenantId,
          resolveProvider(((req as unknown) as { provider?: string }).provider)
        );
        return attachTenant(await p.initThreeDSPayment(req));
      },
      completeThreeDSPayment: async (req) => {
        const p = await getTenantProvider(
          tenantId,
          resolveProvider(((req as unknown) as { provider?: string }).provider)
        );
        return attachTenant(await p.completeThreeDSPayment(req));
      },
      authorize: async (req) => {
        const p = await getTenantProvider(
          tenantId,
          resolveProvider(((req as unknown) as { provider?: string }).provider)
        );
        return attachTenant(await p.authorize(req));
      },
      initThreeDSAuthorize: async (req) => {
        const p = await getTenantProvider(
          tenantId,
          resolveProvider(((req as unknown) as { provider?: string }).provider)
        );
        return attachTenant(await p.initThreeDSAuthorize(req));
      },
      capture: async (req) => {
        const p = await getTenantProvider(
          tenantId,
          resolveProvider(((req as unknown) as { provider?: string }).provider)
        );
        return attachTenant(await p.capture(req));
      },
      voidAuthorization: async (req) => {
        const p = await getTenantProvider(
          tenantId,
          resolveProvider(((req as unknown) as { provider?: string }).provider)
        );
        return attachTenant(await p.voidAuthorization(req));
      },
      refund: async (req) => {
        const p = await getTenantProvider(
          tenantId,
          resolveProvider(((req as unknown) as { provider?: string }).provider)
        );
        return attachTenant(await p.refund(req));
      },
      cancel: async (req) => {
        const p = await getTenantProvider(
          tenantId,
          resolveProvider(((req as unknown) as { provider?: string }).provider)
        );
        return attachTenant(await p.cancel(req));
      },
      getPayment: async (paymentId, provider) => {
        const p = await getTenantProvider(tenantId, resolveProvider(provider));
        return attachTenant(await p.getPayment(paymentId));
      },
      saveCard: async (req) => {
        const p = await getTenantProvider(
          tenantId,
          resolveProvider(((req as unknown) as { provider?: string }).provider)
        );
        return await p.saveCard(req);
      },
      listCards: async (req) => {
        const p = await getTenantProvider(
          tenantId,
          resolveProvider(((req as unknown) as { provider?: string }).provider)
        );
        return await p.listCards(req);
      },
      deleteCard: async (req) => {
        const p = await getTenantProvider(
          tenantId,
          resolveProvider(((req as unknown) as { provider?: string }).provider)
        );
        return await p.deleteCard(req);
      },
      binCheck: async (bin, provider) => {
        const p = await getTenantProvider(tenantId, resolveProvider(provider));
        return await p.binCheck(bin);
      },
      installmentInfo: async (req) => {
        const p = await getTenantProvider(
          tenantId,
          resolveProvider(((req as unknown) as { provider?: string }).provider)
        );
        return await p.installmentInfo(req);
      },
    };
  };

  return definePlugin({
    id: 'multi-tenant',
    options,
    init(ctx) {
      pluginCtx = ctx;
    },
    hooks: {
      before: [
        {
          handler: async (ctx) => {
            const tenantId = await resolveTenantId(ctx);
            if (!tenantId) return undefined;

            const providerId =
              ctx.provider ??
              pluginCtx.defaultProvider ??
              (pluginCtx.providerIds.length > 0 ? pluginCtx.providerIds[0] : 'default');

            const tenantProvider = await getTenantProvider(tenantId, providerId);
            const op = ctx.operation as keyof PaymentProvider;
            const opFn = tenantProvider[op];

            if (typeof opFn === 'function') {
              const res = await (opFn as (req: unknown) => Promise<unknown>).call(
                tenantProvider,
                ctx.request
              );
              if (res && typeof res === 'object') {
                ((res as unknown) as Record<string, unknown>).tenantId = tenantId;
              }
              return { result: res };
            }
            return undefined;
          },
        },
      ],
      after: [
        {
          handler: async (ctx) => {
            const tenantId = await resolveTenantId(ctx as unknown as OperationContext);
            if (tenantId && ctx.result && typeof ctx.result === 'object') {
              ((ctx.result as unknown) as Record<string, unknown>).tenantId = tenantId;
            }
          },
        },
      ],
    },
    methods: (ctx) => {
      pluginCtx = ctx;
      return {
        forTenant: (tenantId: string): TenantPaymentClient => {
          if (!tenantId || typeof tenantId !== 'string') {
            throw new ConfigurationError('forTenant requires a non-empty tenantId string');
          }
          return createTenantClient(tenantId);
        },
        tenants: {
          /** Clears cached provider instances, optionally for a specific tenant */
          clearCache: (tenantId?: string) => {
            if (tenantId) {
              for (const key of cache.keys()) {
                if (key.startsWith(`${tenantId}:`)) {
                  cache.delete(key);
                }
              }
            } else {
              cache.clear();
            }
          },
          /** Returns current cache statistics */
          getCacheStats: () => ({
            size: cache.size,
            maxSize,
            ttl,
          }),
        },
      };
    },
  });
}
