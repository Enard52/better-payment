import {
  ConfigurationError,
  definePlugin,
  type BetterPaymentPlugin,
  type BetterPaymentRequest,
  type BetterPaymentResponse,
  type RequestContext,
} from 'better-payment';

/**
 * Storage backend interface for rate limiting counters.
 */
export interface RateLimitStore {
  /**
   * Increments the hit count for a key within a window in milliseconds.
   * Returns the updated count and the epoch timestamp (ms) when the window resets.
   */
  increment(
    key: string,
    windowMs: number
  ): Promise<{ count: number; resetAt: number }> | { count: number; resetAt: number };

  /** Optional method to clear or reset a key (or all keys if omitted) */
  reset?(key?: string): Promise<void> | void;
}

/**
 * In-memory sliding-window counter store for rate limiting.
 */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly entries = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly maxEntries = 10_000) {}

  increment(key: string, windowMs: number): { count: number; resetAt: number } {
    const now = Date.now();
    const entry = this.entries.get(key);
    if (!entry || entry.resetAt <= now) {
      const resetAt = now + windowMs;
      const newEntry = { count: 1, resetAt };
      this.entries.set(key, newEntry);
      while (this.entries.size > this.maxEntries) {
        const oldest = this.entries.keys().next().value;
        if (oldest === undefined) break;
        this.entries.delete(oldest);
      }
      return newEntry;
    }

    entry.count += 1;
    return entry;
  }

  reset(key?: string): void {
    if (key) {
      this.entries.delete(key);
    } else {
      this.entries.clear();
    }
  }
}

export interface RateLimitRule {
  /** Window duration string (e.g. '1m', '30s', '1h') or milliseconds */
  window?: string | number;
  /** Maximum number of requests allowed within the window */
  max?: number;
}

export interface RateLimitOptions {
  /** Default window duration string (e.g. '1m', '30s', '1h') or milliseconds. Default: '1m' (60s) */
  window?: string | number;
  /** Default maximum requests per window. Default: 60 */
  max?: number;
  /**
   * Per-route rate limiting rules or exclusions.
   * Set a rule to `false` to completely exclude that route from rate limiting.
   */
  rules?: Record<string, RateLimitRule | false>;
  /**
   * Key function to identify the client (e.g. by IP address or API key).
   * Default extracts client IP from X-Forwarded-For, X-Real-IP, CF-Connecting-IP.
   */
  key?: (req: BetterPaymentRequest) => string | Promise<string>;
  /** Storage backend for rate limiting counters. Default: in-memory store */
  store?: RateLimitStore;
  /** Whether to exclude payment provider callbacks by default. Default: true */
  excludeCallbacks?: boolean;
}

/**
 * Parses a window duration string (e.g. '1m', '30s', '1h', '1d', '500ms') or number to milliseconds.
 */
export function parseDuration(val: string | number): number {
  if (typeof val === 'number') {
    if (!Number.isFinite(val) || val <= 0) {
      throw new ConfigurationError(`rateLimit: window must be a positive number, got ${val}`);
    }
    return val;
  }
  if (typeof val !== 'string' || !val.trim()) {
    throw new ConfigurationError(`rateLimit: invalid window duration '${val}'`);
  }
  const match = val.trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$/i);
  if (!match) {
    throw new ConfigurationError(`rateLimit: invalid window duration format '${val}'`);
  }
  const num = parseFloat(match[1]);
  const unit = (match[2] ?? 'ms').toLowerCase();
  switch (unit) {
    case 'd':
      return Math.round(num * 86_400_000);
    case 'h':
      return Math.round(num * 3_600_000);
    case 'm':
      return Math.round(num * 60_000);
    case 's':
      return Math.round(num * 1_000);
    case 'ms':
    default:
      return Math.round(num);
  }
}

function getHeader(request: BetterPaymentRequest, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(request.headers ?? {})) {
    if (key.toLowerCase() === target) return value;
  }
  return undefined;
}

function defaultKeyExtractor(req: BetterPaymentRequest): string {
  const forwarded = getHeader(req, 'x-forwarded-for');
  if (forwarded) {
    const client = forwarded.split(',')[0].trim();
    if (client) return client;
  }
  const realIp = getHeader(req, 'x-real-ip');
  if (realIp?.trim()) return realIp.trim();
  const cfIp = getHeader(req, 'cf-connecting-ip');
  if (cfIp?.trim()) return cfIp.trim();
  return 'unknown';
}

function isCallbackPath(path: string): boolean {
  const normalized = path.replace(/\/+$/, '');
  return (
    normalized.endsWith('/callback') ||
    normalized.includes('/callback/') ||
    normalized.endsWith('/complete-3ds') ||
    normalized === '/callback'
  );
}

function matchesRule(pattern: string, path: string): boolean {
  const normPattern = pattern.replace(/\/+$/, '');
  const normPath = path.replace(/\/+$/, '');

  if (normPattern === normPath) return true;

  // Wildcard matching (e.g. '/callback/*', '*/payment')
  if (normPattern.includes('*')) {
    const regexSource = normPattern
      .split('*')
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*');
    const regex = new RegExp(`^${regexSource}$`, 'i');
    const prefixedRegex = new RegExp(`^/[^/]+${regexSource}$`, 'i');
    return regex.test(normPath) || prefixedRegex.test(normPath);
  }

  // Exact suffix / action match (e.g. '/payment' matches '/iyzico/payment')
  const actionPattern = normPattern.startsWith('/') ? normPattern : `/${normPattern}`;
  if (normPath === actionPattern || normPath.endsWith(actionPattern)) {
    return true;
  }

  return false;
}

/**
 * General HTTP request rate limiter for better-payment handler endpoints.
 *
 * Protects against bot floods and brute-force testing on payment, 3D Secure,
 * and query endpoints while excluding provider callbacks by default.
 *
 * @example
 * ```ts
 * import { rateLimit } from 'better-payment/plugins';
 *
 * const payment = betterPayment({
 *   providers: { ... },
 *   plugins: [
 *     rateLimit({
 *       window: '1m',
 *       max: 30,
 *       rules: {
 *         '/payment': { window: '1m', max: 5 },
 *         '/callback/*': false, // never limit callbacks
 *       },
 *       key: (req) => req.headers.get?.('x-forwarded-for') ?? 'unknown',
 *     }),
 *   ],
 * });
 * ```
 */
export function rateLimit(options: RateLimitOptions = {}): BetterPaymentPlugin {
  const defaultWindowMs = parseDuration(options.window ?? '1m');
  const defaultMax = options.max ?? 60;
  if (defaultMax <= 0) {
    throw new ConfigurationError(`rateLimit: max must be a positive integer, got ${defaultMax}`);
  }

  const store = options.store ?? new MemoryRateLimitStore();
  const keyFn = options.key ?? defaultKeyExtractor;
  const excludeCallbacks = options.excludeCallbacks !== false;
  const rules = options.rules ?? {};

  return definePlugin({
    id: 'rate-limit',
    options,
    $ERROR_CODES: {
      RATE_LIMITED: 'Too many requests, please try again later',
    },
    methods: () => ({
      rateLimit: {
        /** Resets rate limit for a key, or all keys if omitted */
        reset: (key?: string) => store.reset?.(key),
        /** Store instance */
        store,
      },
    }),
    onRequest: async (
      request: BetterPaymentRequest,
      ctx: RequestContext
    ): Promise<BetterPaymentResponse | void> => {
      const path = ctx.path;

      // 1. Check user-defined rules
      let matchedRule: RateLimitRule | false | undefined;
      let matchedPattern: string | undefined;

      for (const [pattern, rule] of Object.entries(rules)) {
        if (matchesRule(pattern, path)) {
          matchedRule = rule;
          matchedPattern = pattern;
          break;
        }
      }

      // If rule is explicitly set to false, route is excluded
      if (matchedRule === false) {
        return;
      }

      // Exclude provider callbacks by default unless matched by an explicit rule
      if (excludeCallbacks && matchedRule === undefined && isCallbackPath(path)) {
        return;
      }

      const windowMs = matchedRule?.window ? parseDuration(matchedRule.window) : defaultWindowMs;
      const limit = matchedRule?.max ?? defaultMax;

      // Ensure req.headers has .get() helper if user passes a function using req.headers.get(...)
      if (request.headers && typeof (request.headers as any).get !== 'function') {
        (request.headers as any).get = (name: string) => getHeader(request, name);
      }

      const clientKey = await keyFn(request);
      const ruleKey = matchedPattern ? `rule:${matchedPattern}` : 'global';
      const storageKey = `${ruleKey}:${clientKey}`;

      const { count, resetAt } = await store.increment(storageKey, windowMs);

      if (count > limit) {
        const now = Date.now();
        const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - now) / 1000));

        return {
          status: 429,
          headers: {
            'content-type': 'application/json',
            'retry-after': String(retryAfterSeconds),
            'x-ratelimit-limit': String(limit),
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': String(Math.ceil(resetAt / 1000)),
          },
          body: {
            status: 'error',
            code: 'RATE_LIMITED',
            errorCode: 'RATE_LIMITED',
            errorMessage: 'Too many requests, please try again later',
          },
        };
      }
    },
  });
}
