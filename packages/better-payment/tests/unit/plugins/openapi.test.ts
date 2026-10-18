import { describe, it, expect } from 'vitest';
import { betterPayment, definePlugin } from 'better-payment';
import { MockProvider } from 'better-payment/testing';
import { openAPI, buildOpenAPISpec } from 'better-payment/plugins';

describe('openAPI plugin', () => {
  it('generates a valid OpenAPI 3.1.0 specification', () => {
    const spec = buildOpenAPISpec({
      info: {
        title: 'Custom Payment API',
        version: '2.0.0',
        description: 'Payment handler documentation',
      },
    });

    expect(spec.openapi).toBe('3.1.0');
    expect(spec.info.title).toBe('Custom Payment API');
    expect(spec.info.version).toBe('2.0.0');
    expect(spec.info.description).toBe('Payment handler documentation');

    // Core routes present
    expect(spec.paths['/{provider}/payment'].post).toBeDefined();
    expect(spec.paths['/{provider}/payment/init-3ds'].post).toBeDefined();
    expect(spec.paths['/{provider}/payment/complete-3ds'].post).toBeDefined();
    expect(spec.paths['/{provider}/payment/{paymentId}'].get).toBeDefined();
    expect(spec.paths['/{provider}/refund'].post).toBeDefined();
    expect(spec.paths['/{provider}/cancel'].post).toBeDefined();
    expect(spec.paths['/{provider}/authorize'].post).toBeDefined();
    expect(spec.paths['/{provider}/capture'].post).toBeDefined();
    expect(spec.paths['/{provider}/void'].post).toBeDefined();
    expect(spec.paths['/{provider}/installment'].post).toBeDefined();
    expect(spec.paths['/{provider}/bin-check'].post).toBeDefined();
    expect(spec.paths['/{provider}/cards/save'].post).toBeDefined();
    expect(spec.paths['/health'].get).toBeDefined();

    // Privileged routes have bearerAuth security
    expect(spec.paths['/{provider}/refund'].post.security).toEqual([{ bearerAuth: [] }]);
    expect(spec.paths['/{provider}/capture'].post.security).toEqual([{ bearerAuth: [] }]);

    // Components include securitySchemes
    expect(spec.components.securitySchemes.bearerAuth).toBeDefined();
  });

  it('serves Scalar reference HTML and openapi.json through the handler', async () => {
    const payment = betterPayment({
      providers: { mock: new MockProvider() },
      plugins: [
        openAPI({
          path: '/reference',
          info: { title: 'Test Store' },
        }),
      ],
      handler: {
        basePath: '/api/pay',
      },
    });

    // 1. GET /reference (HTML)
    const htmlRes = await payment.handler.handle({
      method: 'GET',
      url: 'http://localhost/api/pay/reference',
      headers: {},
    });

    expect(htmlRes.status).toBe(200);
    expect(htmlRes.headers['Content-Type']).toContain('text/html');
    expect(typeof htmlRes.body).toBe('string');
    expect(htmlRes.body as string).toContain('<!doctype html>');
    expect(htmlRes.body as string).toContain('Test Store');
    expect(htmlRes.body as string).toContain('@scalar/api-reference');

    // 2. GET /reference/openapi.json (JSON)
    const jsonRes = await payment.handler.handle({
      method: 'GET',
      url: 'http://localhost/api/pay/reference/openapi.json',
      headers: {},
    });

    expect(jsonRes.status).toBe(200);
    const body = jsonRes.body as Record<string, unknown>;
    expect(body.openapi).toBe('3.1.0');
    expect((body.info as Record<string, unknown>).title).toBe('Test Store');
  });

  it('documents registered plugin endpoints with openapi metadata', async () => {
    const customPlugin = definePlugin({
      id: 'custom-inventory',
      endpoints: {
        stockCheck: {
          method: 'GET',
          path: '/inventory/check',
          privileged: true,
          openapi: {
            summary: 'Check product stock',
            description: 'Returns remaining product stock levels',
            tags: ['Inventory'],
          },
          handler: () => ({ inStock: true }),
        },
      },
    });

    const payment = betterPayment({
      providers: { mock: new MockProvider() },
      plugins: [
        customPlugin,
        openAPI({
          path: '/reference',
        }),
      ],
      handler: {
        basePath: '/api/pay',
        authorize: () => true, // required for privileged endpoints
      },
    });

    const jsonRes = await payment.handler.handle({
      method: 'GET',
      url: 'http://localhost/api/pay/reference/openapi.json',
      headers: {},
    });

    expect(jsonRes.status).toBe(200);
    const spec = jsonRes.body as ReturnType<typeof buildOpenAPISpec>;

    expect(spec.paths['/inventory/check']).toBeDefined();
    const endpointDoc = spec.paths['/inventory/check'].get as Record<string, unknown>;
    expect(endpointDoc.summary).toBe('Check product stock');
    expect(endpointDoc.description).toBe('Returns remaining product stock levels');
    expect(endpointDoc.tags).toEqual(['Inventory']);
    expect(endpointDoc.security).toEqual([{ bearerAuth: [] }]);
  });

  it('returns 404 when disabled option is true', async () => {
    const payment = betterPayment({
      providers: { mock: new MockProvider() },
      plugins: [
        openAPI({
          path: '/reference',
          disabled: true,
        }),
      ],
      handler: {
        basePath: '/api/pay',
      },
    });

    const htmlRes = await payment.handler.handle({
      method: 'GET',
      url: 'http://localhost/api/pay/reference',
      headers: {},
    });
    expect(htmlRes.status).toBe(404);

    const jsonRes = await payment.handler.handle({
      method: 'GET',
      url: 'http://localhost/api/pay/reference/openapi.json',
      headers: {},
    });
    expect(jsonRes.status).toBe(404);
  });

  it('supports custom path option', async () => {
    const payment = betterPayment({
      providers: { mock: new MockProvider() },
      plugins: [
        openAPI({
          path: '/docs',
        }),
      ],
      handler: {
        basePath: '/api/pay',
      },
    });

    const htmlRes = await payment.handler.handle({
      method: 'GET',
      url: 'http://localhost/api/pay/docs',
      headers: {},
    });
    expect(htmlRes.status).toBe(200);

    const jsonRes = await payment.handler.handle({
      method: 'GET',
      url: 'http://localhost/api/pay/docs/openapi.json',
      headers: {},
    });
    expect(jsonRes.status).toBe(200);
  });
});
