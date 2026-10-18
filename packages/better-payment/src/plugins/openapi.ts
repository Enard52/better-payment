import { definePlugin, type BetterPaymentPlugin, type PluginContext } from 'better-payment';

export interface OpenAPIOptions {
  /**
   * Path where the Scalar reference page is served, and where `<path>/openapi.json` is served.
   * Default: '/reference'
   */
  path?: string;
  /**
   * OpenAPI document information metadata
   */
  info?: {
    title?: string;
    version?: string;
    description?: string;
  };
  /**
   * Disables the OpenAPI documentation routes (e.g. in production).
   * When disabled, the routes return 404.
   * Default: false
   */
  disabled?: boolean;
}

export interface OpenAPISpec {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
  };
  paths: Record<string, Record<string, unknown>>;
  components: {
    securitySchemes: Record<string, unknown>;
  };
  tags?: { name: string; description?: string }[];
}

function trimSlashes(p: string): string {
  return p.replace(/^\/+|\/+$/g, '');
}

/**
 * Builds the OpenAPI 3.1.0 document from the configured providers, core handler routes,
 * and registered plugin endpoints.
 */
export function buildOpenAPISpec(options: OpenAPIOptions, ctx?: PluginContext): OpenAPISpec {
  const providerParam = {
    name: 'provider',
    in: 'path',
    required: true,
    description: 'The payment provider id (e.g. iyzico, paytr, akbank, sipay)',
    schema: {
      type: 'string',
      enum: ctx?.providerIds && ctx.providerIds.length > 0 ? ctx.providerIds : undefined,
    },
  };

  const bearerAuth = [{ bearerAuth: [] }];

  const paths: Record<string, Record<string, unknown>> = {
    '/{provider}/payment': {
      post: {
        summary: 'Create payment',
        description:
          'Initiates and charges a direct (non-3D) payment through the selected provider.',
        tags: ['Payments'],
        parameters: [providerParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['price', 'paidPrice'],
                properties: {
                  price: { type: 'string', example: '100.00' },
                  paidPrice: { type: 'string', example: '100.00' },
                  currency: { type: 'string', default: 'TRY', example: 'TRY' },
                  conversationId: { type: 'string', example: 'order-12345' },
                  paymentCard: {
                    type: 'object',
                    properties: {
                      cardHolderName: { type: 'string' },
                      cardNumber: { type: 'string' },
                      expireMonth: { type: 'string' },
                      expireYear: { type: 'string' },
                      cvc: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Payment response' },
          '400': { description: 'Bad request or validation error' },
        },
      },
    },
    '/{provider}/payment/init-3ds': {
      post: {
        summary: 'Initiate 3D Secure payment',
        description:
          'Initiates a 3D Secure payment session and returns HTML or redirect URL for bank challenge.',
        tags: ['3D Secure'],
        parameters: [providerParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['price', 'paidPrice', 'callbackUrl'],
                properties: {
                  price: { type: 'string', example: '100.00' },
                  paidPrice: { type: 'string', example: '100.00' },
                  currency: { type: 'string', default: 'TRY' },
                  callbackUrl: { type: 'string', format: 'uri' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: '3D Secure session initialized' },
        },
      },
    },
    '/{provider}/payment/complete-3ds': {
      post: {
        summary: 'Complete 3D Secure payment',
        description: 'Completes a 3D Secure payment using callback data sent by the bank.',
        tags: ['3D Secure'],
        parameters: [providerParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object' },
            },
          },
        },
        responses: {
          '200': { description: '3D Secure payment completed' },
        },
      },
    },
    '/{provider}/payment/{paymentId}': {
      get: {
        summary: 'Get payment status',
        description: 'Retrieves the details and outcome of a previously processed payment.',
        tags: ['Payments'],
        parameters: [
          providerParam,
          {
            name: 'paymentId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'The payment ID returned by the provider',
          },
        ],
        responses: {
          '200': { description: 'Payment details' },
          '404': { description: 'Payment not found' },
        },
      },
    },
    '/{provider}/callback': {
      post: {
        summary: '3D Secure callback',
        description:
          'Receives the bank authorization callback payload for 3D Secure authentication.',
        tags: ['3D Secure'],
        parameters: [providerParam],
        responses: {
          '200': { description: 'Callback received and processed' },
        },
      },
    },
    '/{provider}/refund': {
      post: {
        summary: 'Refund payment',
        description: 'Refunds a captured transaction in whole or in part. Requires authorization.',
        tags: ['Refunds'],
        security: bearerAuth,
        parameters: [providerParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['paymentId', 'price'],
                properties: {
                  paymentId: { type: 'string' },
                  price: { type: 'string', example: '50.00' },
                  currency: { type: 'string', default: 'TRY' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Refund outcome' },
          '401': { description: 'Unauthorized' },
        },
      },
    },
    '/{provider}/cancel': {
      post: {
        summary: 'Cancel payment',
        description: 'Voids an un-settled transaction on the same day. Requires authorization.',
        tags: ['Refunds'],
        security: bearerAuth,
        parameters: [providerParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['paymentId'],
                properties: {
                  paymentId: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Cancellation outcome' },
        },
      },
    },
    '/{provider}/authorize': {
      post: {
        summary: 'Pre-authorize payment',
        description: 'Blocks the requested amount on customer card without charging.',
        tags: ['Pre-authorization'],
        parameters: [providerParam],
        responses: {
          '200': { description: 'Pre-authorization outcome' },
        },
      },
    },
    '/{provider}/capture': {
      post: {
        summary: 'Capture pre-authorization',
        description: 'Charges previously blocked funds. Requires authorization.',
        tags: ['Pre-authorization'],
        security: bearerAuth,
        parameters: [providerParam],
        responses: {
          '200': { description: 'Capture outcome' },
        },
      },
    },
    '/{provider}/void': {
      post: {
        summary: 'Void pre-authorization',
        description: 'Releases blocked funds back to the cardholder without charging.',
        tags: ['Pre-authorization'],
        security: bearerAuth,
        parameters: [providerParam],
        responses: {
          '200': { description: 'Void outcome' },
        },
      },
    },
    '/{provider}/installment': {
      post: {
        summary: 'Get installment options',
        description: 'Queries available bank installment tiers and commission rates for card BIN.',
        tags: ['Installments'],
        parameters: [providerParam],
        responses: {
          '200': { description: 'Installment table' },
        },
      },
    },
    '/{provider}/bin-check': {
      post: {
        summary: 'BIN lookup',
        description: 'Queries card issuer bank, family, card type and brand from 6-8 digit BIN.',
        tags: ['Cards'],
        parameters: [providerParam],
        responses: {
          '200': { description: 'Card BIN information' },
        },
      },
    },
    '/{provider}/cards/save': {
      post: {
        summary: 'Save card',
        description: 'Stores a credit card token safely on the provider vault.',
        tags: ['Cards'],
        parameters: [providerParam],
        responses: {
          '200': { description: 'Card stored' },
        },
      },
    },
    '/{provider}/cards/list': {
      post: {
        summary: 'List saved cards',
        description: 'Lists stored cards for a given user token.',
        tags: ['Cards'],
        parameters: [providerParam],
        responses: {
          '200': { description: 'List of stored cards' },
        },
      },
    },
    '/{provider}/cards/delete': {
      post: {
        summary: 'Delete saved card',
        description: 'Removes a stored card from the provider vault.',
        tags: ['Cards'],
        parameters: [providerParam],
        responses: {
          '200': { description: 'Card deleted' },
        },
      },
    },
    '/health': {
      get: {
        summary: 'Health check',
        description: 'Returns health status of the payment handler service.',
        tags: ['System'],
        responses: {
          '200': { description: 'Service is healthy' },
        },
      },
    },
  };

  // Add plugin endpoints
  if (ctx?.endpoints) {
    for (const ep of ctx.endpoints) {
      // Don't document the openapi reference routes inside themselves
      if (ep.pluginId === 'openapi') continue;

      const pathKey = ep.path.startsWith('/') ? ep.path : `/${ep.path}`;
      if (!paths[pathKey]) {
        paths[pathKey] = {};
      }

      const methodKey = ep.method.toLowerCase();
      paths[pathKey][methodKey] = {
        summary: ep.openapi?.summary ?? `${ep.name} (${ep.pluginId})`,
        description: ep.openapi?.description ?? `Plugin endpoint provided by ${ep.pluginId}`,
        tags: ep.openapi?.tags ?? ['Plugins', ep.pluginId],
        security: ep.privileged ? bearerAuth : undefined,
        parameters: ep.openapi?.parameters,
        requestBody: ep.openapi?.requestBody,
        responses: ep.openapi?.responses ?? {
          '200': { description: 'Successful response' },
        },
      };
    }
  }

  return {
    openapi: '3.1.0',
    info: {
      title: options.info?.title ?? 'Better Payment API',
      version: options.info?.version ?? '1.0.0',
      description:
        options.info?.description ??
        'OpenAPI 3.1 reference for Better Payment HTTP handler routes and plugin endpoints.',
    },
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'Authorization header for privileged handler endpoints (Bearer token)',
        },
      },
    },
    tags: [
      { name: 'Payments', description: 'Direct payment processing operations' },
      { name: '3D Secure', description: '3D Secure 1.0 & 2.0 authentication flows' },
      { name: 'Refunds', description: 'Refunds and cancellation operations' },
      { name: 'Pre-authorization', description: 'Authorization, capture and void workflows' },
      { name: 'Installments', description: 'Installment queries and bank campaigns' },
      { name: 'Cards', description: 'Stored cards and BIN checks' },
      { name: 'System', description: 'System health checks' },
      { name: 'Plugins', description: 'Endpoints contributed by official and custom plugins' },
    ],
  };
}

function renderScalarHtml(spec: OpenAPISpec, title: string): string {
  const specJson = JSON.stringify(spec).replace(/</g, '\\u003c');
  return `<!doctype html>
<html>
  <head>
    <title>${title}</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { margin: 0; }
    </style>
  </head>
  <body>
    <script
      id="api-reference"
      type="application/json"
      data-configuration='{"spec":{"content":${specJson}},"theme":"purple"}'>
    </script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`;
}

/**
 * OpenAPI plugin for better-payment.
 *
 * Generates an OpenAPI 3.1.0 specification and an interactive Scalar documentation
 * reference page for all HTTP handler routes, configured providers, and plugin endpoints.
 *
 * @example
 * ```ts
 * import { openAPI } from 'better-payment/plugins';
 *
 * const payment = betterPayment({
 *   providers: { ... },
 *   plugins: [
 *     openAPI({
 *       path: '/reference',
 *       info: { title: 'Store Checkout API' },
 *       disabled: process.env.NODE_ENV === 'production',
 *     }),
 *   ],
 * });
 * ```
 */
export function openAPI(options: OpenAPIOptions = {}): BetterPaymentPlugin {
  const rawPath = options.path ?? '/reference';
  const basePath = '/' + trimSlashes(rawPath);
  const jsonPath = `${basePath}/openapi.json`;
  let pluginCtx: PluginContext;

  return definePlugin({
    id: 'openapi',
    options,
    init(ctx) {
      pluginCtx = ctx;
    },
    endpoints: {
      scalarUi: {
        method: 'GET',
        path: basePath,
        handler: (ctx) => {
          if (options.disabled) {
            return ctx.json(
              { status: 'error', errorMessage: 'OpenAPI reference is disabled' },
              404
            );
          }
          const spec = buildOpenAPISpec(options, pluginCtx ?? ctx);
          const html = renderScalarHtml(
            spec,
            options.info?.title ?? 'Better Payment API Reference'
          );
          if (typeof ctx.html === 'function') {
            return ctx.html(html);
          }
          return {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
            body: html,
          };
        },
      },
      openApiJson: {
        method: 'GET',
        path: jsonPath,
        handler: (ctx) => {
          if (options.disabled) {
            return ctx.json(
              { status: 'error', errorMessage: 'OpenAPI reference is disabled' },
              404
            );
          }
          const spec = buildOpenAPISpec(options, pluginCtx ?? ctx);
          return ctx.json(spec);
        },
      },
    },
  });
}
