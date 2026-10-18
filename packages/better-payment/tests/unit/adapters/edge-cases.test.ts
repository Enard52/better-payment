import { describe, it, expect, vi } from 'vitest';
import {
  toExpressHandler,
  type NodeRequestLike,
  type NodeResponseLike,
  type NodeNext,
} from '../../../src/adapters/express';
import {
  toFastifyPlugin,
  type FastifyInstanceLike,
  type FastifyRequestLike,
  type FastifyReplyLike,
} from '../../../src/adapters/fastify';
import type { BetterPaymentHandler, BetterPaymentRequest, BetterPaymentResponse } from '../../../src';

function createMockResponse(): NodeResponseLike & {
  statusCode: number;
  headers: Record<string, string>;
  endedBody: string | undefined;
  setHeader: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
} {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    endedBody: undefined as string | undefined,
    setHeader: vi.fn((name: string, value: string) => {
      res.headers[name] = value;
    }),
    end: vi.fn((body?: string) => {
      res.endedBody = body;
    }),
  };
  return res;
}

function createMockHandler(
  handlerFn: (req: BetterPaymentRequest) => Promise<BetterPaymentResponse> = async () => ({
    status: 200,
    body: 'OK',
  })
): BetterPaymentHandler {
  return {
    handle: vi.fn(handlerFn),
  } as unknown as BetterPaymentHandler;
}

async function* asyncStreamFrom<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) {
    yield item;
  }
}

describe('Express adapter edge cases', () => {
  it('forwards handler failure to next(error) with the same error object', async () => {
    const error = new Error('Database connection failed');
    const handler = createMockHandler(async () => {
      throw error;
    });
    const expressHandler = toExpressHandler(handler);

    const req: NodeRequestLike = {
      method: 'POST',
      url: '/api/pay/callback',
      headers: {},
      [Symbol.asyncIterator]: () => asyncStreamFrom([]),
    };
    const res = createMockResponse();
    const next: NodeNext = vi.fn();

    await expressHandler(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(error);
  });

  it('forwards request-stream failures to next(error) with the same error object', async () => {
    const streamError = new Error('Premature socket close');
    async function* failingStream(): AsyncIterable<string> {
      yield 'part1';
      throw streamError;
    }

    const handler = createMockHandler();
    const expressHandler = toExpressHandler(handler);

    const req: NodeRequestLike = {
      method: 'POST',
      url: '/api/pay/callback',
      headers: {},
      [Symbol.asyncIterator]: failingStream,
    };
    const res = createMockResponse();
    const next: NodeNext = vi.fn();

    await expressHandler(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(streamError);
    expect(handler.handle).not.toHaveBeenCalled();
  });

  it('returns an empty 500 response when no next callback is available without leaking error details', async () => {
    const handler = createMockHandler(async () => {
      throw new Error('Secret internal credential leak');
    });
    const expressHandler = toExpressHandler(handler);

    const req: NodeRequestLike = {
      method: 'POST',
      url: '/api/pay/callback',
      headers: {},
      [Symbol.asyncIterator]: () => asyncStreamFrom([]),
    };
    const res = createMockResponse();

    // Call without next callback
    await expressHandler(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.end).toHaveBeenCalledWith();
    expect(res.endedBody).toBeUndefined();
    expect(res.headers).toEqual({});
  });

  it('returns an empty 500 response when stream fails and no next callback is available', async () => {
    async function* failingStream(): AsyncIterable<string> {
      throw new Error('Socket reset');
    }

    const handler = createMockHandler();
    const expressHandler = toExpressHandler(handler);

    const req: NodeRequestLike = {
      method: 'POST',
      url: '/api/pay/callback',
      headers: {},
      [Symbol.asyncIterator]: failingStream,
    };
    const res = createMockResponse();

    await expressHandler(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.end).toHaveBeenCalledWith();
    expect(res.endedBody).toBeUndefined();
  });

  it('does not consume request streams for GET or HEAD', async () => {
    const iteratorSpy = vi.fn();
    async function* stream(): AsyncIterable<string> {
      iteratorSpy();
      yield 'should-not-be-read';
    }

    const handler = createMockHandler();
    const expressHandler = toExpressHandler(handler);

    for (const method of ['GET', 'get', 'HEAD', 'head']) {
      iteratorSpy.mockClear();
      vi.mocked(handler.handle).mockClear();

      const req: NodeRequestLike = {
        method,
        url: '/api/pay/payment/PMT-1',
        headers: {},
        [Symbol.asyncIterator]: stream,
      };
      const res = createMockResponse();

      await expressHandler(req, res);

      expect(iteratorSpy).not.toHaveBeenCalled();
      expect(handler.handle).toHaveBeenCalledWith(
        expect.objectContaining({
          method: method.toUpperCase(),
          body: undefined,
        })
      );
    }
  });

  it('enforces maxBodySize in bytes for multi-byte string chunks including exact-boundary', async () => {
    const handler = createMockHandler();
    // '₺' (Turkish Lira sign) is 3 bytes in UTF-8
    // 3 * '₺' = 9 bytes
    const liraSign = '₺';
    expect(new TextEncoder().encode(liraSign).byteLength).toBe(3);

    // Limit is 9 bytes
    const expressHandler = toExpressHandler(handler, { maxBodySize: 9 });

    // Exact boundary: 9 bytes (3 * 3) -> should succeed
    const reqExact: NodeRequestLike = {
      method: 'POST',
      url: '/api/pay/callback',
      headers: {},
      [Symbol.asyncIterator]: () => asyncStreamFrom(['₺', '₺', '₺']),
    };
    const resExact = createMockResponse();
    await expressHandler(reqExact, resExact);
    expect(resExact.statusCode).toBe(200);
    expect(handler.handle).toHaveBeenCalledWith(
      expect.objectContaining({ body: '₺₺₺' })
    );

    // Exceeds limit by 1 byte: 10 bytes (3 + 3 + 4 bytes '🚀')
    vi.mocked(handler.handle).mockClear();
    const reqExceeded: NodeRequestLike = {
      method: 'POST',
      url: '/api/pay/callback',
      headers: {},
      [Symbol.asyncIterator]: () => asyncStreamFrom(['₺', '₺', '🚀']),
    };
    const resExceeded = createMockResponse();
    await expressHandler(reqExceeded, resExceeded);
    expect(resExceeded.statusCode).toBe(413);
    expect(handler.handle).not.toHaveBeenCalled();
  });

  it('reassembles split UTF-8 byte chunks without corrupting the request body', async () => {
    const handler = createMockHandler();
    const expressHandler = toExpressHandler(handler);

    // 'Ödeme ₺100' encoded into UTF-8 bytes
    const fullText = 'Ödeme başarılı: ₺100';
    const allBytes = new TextEncoder().encode(fullText);

    // Split at arbitrary byte positions that cut multi-byte characters in half
    // 'Ö' is 2 bytes (bytes 0, 1) -> split between byte 0 and 1
    const chunk1 = allBytes.subarray(0, 1);
    // bytes 1 to 17 (cutting into '₺' which is 3 bytes)
    const chunk2 = allBytes.subarray(1, 18);
    const chunk3 = allBytes.subarray(18);

    const req: NodeRequestLike = {
      method: 'POST',
      url: '/api/pay/callback',
      headers: {},
      [Symbol.asyncIterator]: () => asyncStreamFrom([chunk1, chunk2, chunk3]),
    };
    const res = createMockResponse();

    await expressHandler(req, res);

    expect(handler.handle).toHaveBeenCalledWith(
      expect.objectContaining({
        body: fullText,
      })
    );
  });

  it('returns payloadTooLarge when content-length header exceeds limit upfront', async () => {
    const handler = createMockHandler();
    const expressHandler = toExpressHandler(handler, { maxBodySize: 100 });

    const req: NodeRequestLike = {
      method: 'POST',
      url: '/api/pay/callback',
      headers: { 'content-length': '150' },
      [Symbol.asyncIterator]: () => asyncStreamFrom([]),
    };
    const res = createMockResponse();

    await expressHandler(req, res);

    expect(res.statusCode).toBe(413);
    expect(handler.handle).not.toHaveBeenCalled();
  });

  it('uses req.body when req.readableEnded is true (body parser already ran)', async () => {
    const handler = createMockHandler();
    const expressHandler = toExpressHandler(handler);

    const parsedBody = { parsedByExpress: true };
    const req: NodeRequestLike = {
      method: 'POST',
      url: '/api/pay/callback',
      headers: {},
      body: parsedBody,
      readableEnded: true,
      [Symbol.asyncIterator]: () => asyncStreamFrom([]),
    };
    const res = createMockResponse();

    await expressHandler(req, res);

    expect(handler.handle).toHaveBeenCalledWith(
      expect.objectContaining({
        body: parsedBody,
      })
    );
  });
});

describe('Fastify adapter edge cases', () => {
  function createFastifyMock(): {
    instance: FastifyInstanceLike;
    routes: Map<string, (req: FastifyRequestLike, reply: FastifyReplyLike) => Promise<unknown>>;
    parsers: Map<string, unknown>;
  } {
    const routes = new Map<string, (req: FastifyRequestLike, reply: FastifyReplyLike) => Promise<unknown>>();
    const parsers = new Map<string, unknown>();

    const instance: FastifyInstanceLike = {
      hasContentTypeParser: vi.fn((type: string) => parsers.has(type)),
      addContentTypeParser: vi.fn((type: string, _opts: unknown, parser: unknown) => {
        parsers.set(type, parser);
      }),
      all: vi.fn((path: string, routeHandler: (req: FastifyRequestLike, reply: FastifyReplyLike) => Promise<unknown>) => {
        routes.set(path, routeHandler);
      }),
    };

    return { instance, routes, parsers };
  }

  function createReplyMock(): FastifyReplyLike & {
    statusCode: number;
    headers: Record<string, string>;
    sentPayload: unknown;
  } {
    const reply = {
      statusCode: 200,
      headers: {} as Record<string, string>,
      sentPayload: undefined as unknown,
      code: vi.fn((code: number) => {
        reply.statusCode = code;
        return reply;
      }),
      header: vi.fn((name: string, value: string) => {
        reply.headers[name] = value;
        return reply;
      }),
      send: vi.fn((payload?: unknown) => {
        reply.sentPayload = payload;
        return reply;
      }),
    };
    return reply;
  }

  it('preserves an existing application/x-www-form-urlencoded parser', async () => {
    const { instance, parsers } = createFastifyMock();
    const customParser = vi.fn();
    parsers.set('application/x-www-form-urlencoded', customParser);

    const plugin = toFastifyPlugin(createMockHandler());
    await plugin(instance);

    expect(instance.hasContentTypeParser).toHaveBeenCalledWith('application/x-www-form-urlencoded');
    expect(instance.addContentTypeParser).not.toHaveBeenCalled();
    expect(parsers.get('application/x-www-form-urlencoded')).toBe(customParser);
  });

  it('registers the raw form parser once when missing and keeps its body unchanged', async () => {
    const { instance, parsers } = createFastifyMock();

    const plugin = toFastifyPlugin(createMockHandler());
    await plugin(instance);

    expect(instance.hasContentTypeParser).toHaveBeenCalledWith('application/x-www-form-urlencoded');
    expect(instance.addContentTypeParser).toHaveBeenCalledWith(
      'application/x-www-form-urlencoded',
      { parseAs: 'string' },
      expect.any(Function)
    );

    const registeredParser = parsers.get('application/x-www-form-urlencoded') as (
      req: unknown,
      body: string,
      done: (err: Error | null, res?: unknown) => void
    ) => void;
    expect(registeredParser).toBeDefined();

    const done = vi.fn();
    const rawBody = 'status=success&paymentId=123&hash=xyz';
    registeredParser({}, rawBody, done);

    expect(done).toHaveBeenCalledWith(null, rawBody);
  });

  it('normalizes an empty body to undefined', async () => {
    const handler = createMockHandler();
    const { instance, routes } = createFastifyMock();

    const plugin = toFastifyPlugin(handler);
    await plugin(instance);

    const route = routes.get('/');
    expect(route).toBeDefined();

    const reply = createReplyMock();
    await route!(
      {
        method: 'POST',
        url: '/api/pay/callback',
        headers: {},
        body: '',
      },
      reply
    );

    expect(handler.handle).toHaveBeenCalledWith(
      expect.objectContaining({
        body: undefined,
      })
    );
  });

  it('preserves non-empty string and object bodies unchanged', async () => {
    const handler = createMockHandler();
    const { instance, routes } = createFastifyMock();

    const plugin = toFastifyPlugin(handler);
    await plugin(instance);

    const route = routes.get('/*');
    expect(route).toBeDefined();

    // String body
    const reply1 = createReplyMock();
    await route!(
      {
        method: 'POST',
        url: '/api/pay/callback',
        headers: {},
        body: 'a=1&b=2',
      },
      reply1
    );
    expect(handler.handle).toHaveBeenCalledWith(expect.objectContaining({ body: 'a=1&b=2' }));

    // Object body
    const reply2 = createReplyMock();
    await route!(
      {
        method: 'POST',
        url: '/api/pay/payment',
        headers: {},
        body: { amount: 100 },
      },
      reply2
    );
    expect(handler.handle).toHaveBeenCalledWith(expect.objectContaining({ body: { amount: 100 } }));
  });

  it('flattens array headers and omits undefined headers', async () => {
    const handler = createMockHandler();
    const { instance, routes } = createFastifyMock();

    const plugin = toFastifyPlugin(handler);
    await plugin(instance);

    const route = routes.get('/');
    const reply = createReplyMock();

    await route!(
      {
        method: 'GET',
        url: '/api/pay/health',
        headers: {
          'x-forwarded-for': ['10.0.0.1', '10.0.0.2'],
          'content-type': 'application/json',
          'x-ignored': undefined,
        },
      },
      reply
    );

    expect(handler.handle).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: {
          'x-forwarded-for': '10.0.0.1, 10.0.0.2',
          'content-type': 'application/json',
        },
      })
    );
    const sentHeaders = (vi.mocked(handler.handle).mock.calls[0][0] as BetterPaymentRequest).headers;
    expect(sentHeaders).not.toHaveProperty('x-ignored');
  });

  it('lets handler rejections propagate to Fastify', async () => {
    const handlerError = new Error('Async handler boom');
    const handler = createMockHandler(async () => {
      throw handlerError;
    });
    const { instance, routes } = createFastifyMock();

    const plugin = toFastifyPlugin(handler);
    await plugin(instance);

    const route = routes.get('/');
    const reply = createReplyMock();

    await expect(
      route!(
        {
          method: 'POST',
          url: '/api/pay/callback',
          headers: {},
        },
        reply
      )
    ).rejects.toThrow(handlerError);
  });
});
