import {
  ConfigurationError,
  definePlugin,
  PaymentErrorCode,
  PaymentStatus,
  type OperationContext,
  type PaymentOperation,
  type PluginContext,
} from 'better-payment';

interface OperationResultLike {
  status?: PaymentStatus;
  code?: PaymentErrorCode | string;
  errorCode?: string;
  errorMessage?: string;
  paymentId?: string;
  [key: string]: unknown;
}

type OperationFn = (request: unknown) => Promise<OperationResultLike | undefined>;

/**
 * Event emitted whenever failover switches to a backup provider.
 */
export interface FailoverSwitchEvent {
  operation: PaymentOperation;
  fromProvider: string;
  toProvider: string;
  error: {
    code?: string;
    errorCode?: string;
    errorMessage?: string;
  };
  attempt: number;
  conversationId?: string;
}

export type FailoverSwitchListener = (event: FailoverSwitchEvent) => void | Promise<void>;

export interface ProviderCircuitStatus {
  state: 'closed' | 'open' | 'half_open';
  failures: number;
  openedAt?: Date;
  cooldownRemainingMs?: number;
}

export interface CircuitBreakerOptions {
  /**
   * Number of consecutive transient failures within window to trip the circuit.
   * Default: 5
   */
  failures?: number;
  /**
   * Time window for counting failures: milliseconds or '30s', '1m', '5m'.
   * Default: '1m'
   */
  window?: number | string;
  /**
   * Cooldown period before transitioning to half-open: milliseconds or '1m', '5m'.
   * Default: '5m'
   */
  cooldown?: number | string;
}

export interface FailoverOptions {
  /**
   * The fallback sequence of providers to try.
   * Default: all configured providers.
   */
  order?: string[];
  /**
   * Only retry on these transient errors where the payment surely did not go through.
   * Default: ['PROVIDER_ERROR', 'PROVIDER_UNAVAILABLE', 'TIMEOUT_BEFORE_SEND']
   */
  on?: (PaymentErrorCode | string)[];
  /**
   * Circuit breaker configuration to skip unhealthy providers during outages.
   */
  circuitBreaker?: boolean | CircuitBreakerOptions;
  /**
   * Callback fired when failover switches to another provider.
   */
  onSwitch?: FailoverSwitchListener;
}

const UNITS: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };

function toMs(delay: number | string, paramName: string): number {
  if (typeof delay === 'number') {
    if (delay <= 0) throw new ConfigurationError(`failover: ${paramName} must be greater than 0.`);
    return delay;
  }
  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h)$/.exec(delay.trim());
  if (!match) {
    throw new ConfigurationError(
      `failover: invalid ${paramName} '${delay}'. Use milliseconds or '500ms', '30s', '1m', '5m'.`
    );
  }
  return Number(match[1]) * UNITS[match[2]];
}

class CircuitBreaker {
  private failureTimestamps = new Map<string, number[]>();
  private openedAtMap = new Map<string, number>();
  private readonly failuresThreshold: number;
  private readonly windowMs: number;
  private readonly cooldownMs: number;
  readonly enabled: boolean;

  constructor(options?: boolean | CircuitBreakerOptions) {
    if (!options) {
      this.enabled = false;
      this.failuresThreshold = 5;
      this.windowMs = 60_000;
      this.cooldownMs = 300_000;
      return;
    }
    this.enabled = true;
    const opts = typeof options === 'object' ? options : {};
    this.failuresThreshold = opts.failures ?? 5;
    this.windowMs = opts.window ? toMs(opts.window, 'window') : 60_000;
    this.cooldownMs = opts.cooldown ? toMs(opts.cooldown, 'cooldown') : 300_000;

    if (this.failuresThreshold <= 0) {
      throw new ConfigurationError('failover: circuitBreaker.failures must be at least 1.');
    }
  }

  getState(providerId: string, now = Date.now()): 'closed' | 'open' | 'half_open' {
    if (!this.enabled) return 'closed';
    const openedAt = this.openedAtMap.get(providerId);
    if (openedAt !== undefined) {
      if (now - openedAt >= this.cooldownMs) {
        return 'half_open';
      }
      return 'open';
    }
    return 'closed';
  }

  recordSuccess(providerId: string): void {
    if (!this.enabled) return;
    this.openedAtMap.delete(providerId);
    this.failureTimestamps.delete(providerId);
  }

  recordFailure(providerId: string, now = Date.now()): void {
    if (!this.enabled) return;
    const state = this.getState(providerId, now);
    if (state === 'half_open') {
      this.openedAtMap.set(providerId, now);
      return;
    }

    const list = (this.failureTimestamps.get(providerId) ?? []).filter(
      (ts) => now - ts < this.windowMs
    );
    list.push(now);
    this.failureTimestamps.set(providerId, list);

    if (list.length >= this.failuresThreshold) {
      this.openedAtMap.set(providerId, now);
    }
  }

  trip(providerId: string, now = Date.now()): void {
    this.openedAtMap.set(providerId, now);
  }

  reset(providerId?: string): void {
    if (providerId) {
      this.openedAtMap.delete(providerId);
      this.failureTimestamps.delete(providerId);
    } else {
      this.openedAtMap.clear();
      this.failureTimestamps.clear();
    }
  }

  status(providerIds: readonly string[], now = Date.now()): Record<string, ProviderCircuitStatus> {
    const result: Record<string, ProviderCircuitStatus> = {};
    for (const id of providerIds) {
      const state = this.getState(id, now);
      const openedAt = this.openedAtMap.get(id);
      const failures = (this.failureTimestamps.get(id) ?? []).filter(
        (ts) => now - ts < this.windowMs
      ).length;

      let cooldownRemainingMs: number | undefined;
      if (openedAt !== undefined) {
        const remaining = this.cooldownMs - (now - openedAt);
        cooldownRemainingMs = remaining > 0 ? remaining : 0;
      }

      result[id] = {
        state,
        failures,
        ...(openedAt !== undefined ? { openedAt: new Date(openedAt), cooldownRemainingMs } : {}),
      };
    }
    return result;
  }
}

const DEFAULT_TRANSIENT_ERRORS: readonly string[] = [
  PaymentErrorCode.PROVIDER_ERROR,
  'PROVIDER_ERROR',
  'PROVIDER_UNAVAILABLE',
  'TIMEOUT_BEFORE_SEND',
  'SYSTEM_ERROR',
];

/**
 * Provider failover plugin: automatically retries non-3DS payments and authorizations
 * on backup providers when a transient outage occurs, with circuit breaker protection.
 *
 * @example
 * ```ts
 * import { failover } from 'better-payment/plugins';
 *
 * const payment = betterPayment({
 *   providers: { iyzico: iyzico({ ... }), paytr: paytr({ ... }) },
 *   plugins: [
 *     failover({
 *       order: ['iyzico', 'paytr'],
 *       on: ['PROVIDER_UNAVAILABLE', 'TIMEOUT_BEFORE_SEND'],
 *       circuitBreaker: { failures: 5, window: '1m', cooldown: '5m' },
 *     }),
 *   ],
 * });
 * ```
 */
export const failover = (options: FailoverOptions = {}) => {
  const cb = new CircuitBreaker(options.circuitBreaker);
  const switchListeners: FailoverSwitchListener[] = [];
  if (options.onSwitch) {
    switchListeners.push(options.onSwitch);
  }

  const onErrors = new Set<string>(
    (options.on ? options.on.map(String) : DEFAULT_TRANSIENT_ERRORS)
  );

  let pluginCtx: PluginContext;

  const getCandidateOrder = (initialProvider: string | undefined): string[] => {
    const configured = pluginCtx.providerIds;
    const baseOrder = options.order && options.order.length > 0 ? options.order : configured;

    if (!initialProvider) {
      return [...baseOrder];
    }

    const rest = baseOrder.filter((p) => p !== initialProvider);
    return [initialProvider, ...rest];
  };

  return definePlugin({
    id: 'failover',
    options,
    init: (ctx) => {
      pluginCtx = ctx;
      if (options.order) {
        for (const id of options.order) {
          if (!ctx.providerIds.includes(id)) {
            throw new ConfigurationError(
              `failover: provider '${id}' in order is not configured. Configured providers: ${ctx.providerIds.join(', ')}`
            );
          }
        }
      }
    },
    hooks: {
      before: [
        {
          matcher: (ctx) =>
            ctx.routable && (ctx.operation === 'createPayment' || ctx.operation === 'authorize'),
          handler: async (ctx: OperationContext) => {
            const candidates = getCandidateOrder(ctx.provider);
            if (candidates.length <= 1) {
              return;
            }

            // Filter out candidates whose circuit is OPEN
            const availableCandidates = candidates.filter((id) => cb.getState(id) !== 'open');
            const toTry = availableCandidates.length > 0 ? availableCandidates : [candidates[0]];

            let lastResult: unknown;
            let lastProvider = toTry[0];
            let attempt = 0;

            for (let i = 0; i < toTry.length; i++) {
              const currentProvider = toTry[i];
              attempt++;

              try {
                const provider = pluginCtx.rawProvider
                  ? pluginCtx.rawProvider(currentProvider)
                  : pluginCtx.use(currentProvider);

                const result = await (provider[ctx.operation] as OperationFn).call(
                  provider,
                  ctx.request
                );
                lastResult = result;
                lastProvider = currentProvider;

                // Success
                if (result?.status === PaymentStatus.SUCCESS) {
                  cb.recordSuccess(currentProvider);
                  return { provider: currentProvider, result };
                }

                // If outcome is unknown / pending (e.g. NETWORK_ERROR), NEVER retry
                if (
                  result?.status === PaymentStatus.PENDING ||
                  result?.code === PaymentErrorCode.NETWORK_ERROR
                ) {
                  return { provider: currentProvider, result };
                }

                // Check if failure is transient
                const code = result?.code ? String(result.code) : undefined;
                const errorCode = result?.errorCode ? String(result.errorCode) : undefined;
                const isTransient =
                  (code !== undefined && onErrors.has(code)) ||
                  (errorCode !== undefined && onErrors.has(errorCode));

                if (!isTransient) {
                  // Non-transient decline / user error: do not failover
                  return { provider: currentProvider, result };
                }

                // Transient failure: record failure in circuit breaker
                cb.recordFailure(currentProvider);

                // If another candidate is available, switch
                const nextIndex = i + 1;
                if (nextIndex < toTry.length) {
                  const nextProvider = toTry[nextIndex];
                  const switchEvent: FailoverSwitchEvent = {
                    operation: ctx.operation,
                    fromProvider: currentProvider,
                    toProvider: nextProvider,
                    error: {
                      code,
                      errorCode,
                      errorMessage: result?.errorMessage,
                    },
                    attempt,
                    conversationId: (ctx.request as Record<string, unknown>)?.conversationId as
                      | string
                      | undefined,
                  };

                  for (const listener of switchListeners) {
                    try {
                      await listener(switchEvent);
                    } catch (err) {
                      pluginCtx.logger?.error('failover switch listener failed', err as Error);
                    }
                  }
                }
              } catch (err) {
                cb.recordFailure(currentProvider);
                lastResult = {
                  status: PaymentStatus.FAILURE,
                  code: PaymentErrorCode.PROVIDER_ERROR,
                  errorMessage: err instanceof Error ? err.message : String(err),
                };
                lastProvider = currentProvider;
              }
            }

            return { provider: lastProvider, result: lastResult };
          },
        },
      ],
    },
    methods: (ctx) => ({
      failover: {
        status: () => cb.status(ctx.providerIds),
        reset: (providerId?: string) => cb.reset(providerId),
        trip: (providerId: string) => cb.trip(providerId),
        onSwitch: (listener: FailoverSwitchListener) => {
          switchListeners.push(listener);
          return () => {
            const idx = switchListeners.indexOf(listener);
            if (idx !== -1) switchListeners.splice(idx, 1);
          };
        },
      },
    }),
  });
};
