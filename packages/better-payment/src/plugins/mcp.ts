import {
  definePlugin,
  type BetterPaymentPlugin,
  type BetterPaymentRequest,
  type PluginContext,
} from 'better-payment';

export type McpToolName = 'getPayment' | 'binCheck' | 'installmentInfo' | 'refund' | 'cancel';

export const ALL_MCP_TOOLS: readonly McpToolName[] = [
  'getPayment',
  'binCheck',
  'installmentInfo',
  'refund',
  'cancel',
];

export const WRITE_MCP_TOOLS: readonly McpToolName[] = ['refund', 'cancel'];

export interface McpOptions {
  /**
   * Endpoint path relative to the handler basePath. Default: '/mcp'
   */
  path?: string;
  /**
   * List of tools exposed by the MCP server. Default: all available tools.
   */
  tools?: McpToolName[];
  /**
   * Authorizes the agent request. Required for write operations ('refund', 'cancel'),
   * or can protect all MCP calls.
   */
  authorize?: (request: BetterPaymentRequest) => boolean | Promise<boolean>;
  /**
   * When true, only read-only tools ('getPayment', 'binCheck', 'installmentInfo') are exposed.
   * Default: false
   */
  readOnly?: boolean;
  /**
   * Callback invoked on every tool call for audit logging and observability.
   */
  onToolCall?: (info: {
    tool: string;
    args: Record<string, unknown>;
    result?: unknown;
    error?: unknown;
    timestamp: number;
  }) => void;
}

const TOOL_DEFINITIONS: Record<
  McpToolName,
  {
    description: string;
    inputSchema: {
      type: 'object';
      properties: Record<string, { type: string; description: string }>;
      required: string[];
    };
  }
> = {
  getPayment: {
    description: 'Look up payment details and status by payment ID',
    inputSchema: {
      type: 'object',
      properties: {
        paymentId: {
          type: 'string',
          description: 'The provider payment ID returned during checkout',
        },
        provider: {
          type: 'string',
          description: 'Payment provider ID (e.g. iyzico, paytr). Defaults to default provider',
        },
      },
      required: ['paymentId'],
    },
  },
  binCheck: {
    description:
      'Query card issuer bank, card family, card type and brand from first 6-8 digits of a card',
    inputSchema: {
      type: 'object',
      properties: {
        binNumber: { type: 'string', description: 'The first 6 to 8 digits of the payment card' },
        provider: { type: 'string', description: 'Payment provider ID' },
      },
      required: ['binNumber'],
    },
  },
  installmentInfo: {
    description:
      'Query available installment counts and bank campaign commission rates for card BIN and amount',
    inputSchema: {
      type: 'object',
      properties: {
        binNumber: { type: 'string', description: 'Card BIN number (first 6-8 digits)' },
        price: { type: 'string', description: 'Transaction amount (e.g. "100.00")' },
        currency: { type: 'string', description: 'Currency code (e.g. TRY, USD)' },
        provider: { type: 'string', description: 'Payment provider ID' },
      },
      required: ['binNumber', 'price'],
    },
  },
  refund: {
    description: 'Issue a partial or full refund for a captured payment transaction',
    inputSchema: {
      type: 'object',
      properties: {
        paymentId: { type: 'string', description: 'Payment ID to refund' },
        price: { type: 'string', description: 'Amount to refund' },
        currency: { type: 'string', description: 'Currency code (default: TRY)' },
        conversationId: { type: 'string', description: 'Merchant reference or ticket ID' },
        provider: { type: 'string', description: 'Payment provider ID' },
      },
      required: ['paymentId', 'price'],
    },
  },
  cancel: {
    description: 'Void / cancel an unsettled transaction on the same day before batch settlement',
    inputSchema: {
      type: 'object',
      properties: {
        paymentId: { type: 'string', description: 'Payment ID to void/cancel' },
        conversationId: { type: 'string', description: 'Merchant reference or ticket ID' },
        provider: { type: 'string', description: 'Payment provider ID' },
      },
      required: ['paymentId'],
    },
  },
};

const SENSITIVE_CARD_KEYS = new Set([
  'card',
  'cardNumber',
  'cvv',
  'securityCode',
  'expireMonth',
  'expireYear',
  'cardHolderName',
]);

function sanitizeOutput(value: unknown): unknown {
  if (value === null || value === undefined || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeOutput);
  }
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_CARD_KEYS.has(k)) continue;
    clean[k] = sanitizeOutput(v);
  }
  return clean;
}

function trimSlashes(path: string): string {
  return path.replace(/^\/+|\/+$/g, '');
}

/**
 * Model Context Protocol (MCP) server plugin for better-payment.
 *
 * Exposes payment queries (getPayment, binCheck, installmentInfo) and write operations (refund, cancel)
 * as standard MCP tools over HTTP for AI agents (Cursor, Claude Desktop, OpenAI Assistants, LangChain).
 *
 * @example
 * ```ts
 * import { mcp } from 'better-payment/plugins';
 *
 * const payment = betterPayment({
 *   providers: { iyzico: iyzico({ ... }) },
 *   plugins: [
 *     mcp({
 *       path: '/mcp',
 *       tools: ['getPayment', 'binCheck', 'installmentInfo', 'refund'],
 *       authorize: (req) => req.headers['authorization'] === 'Bearer agent_secret',
 *       readOnly: false,
 *     }),
 *   ],
 * });
 * ```
 */
export function mcp(options: McpOptions = {}): BetterPaymentPlugin {
  const mcpPath = '/' + trimSlashes(options.path ?? '/mcp');
  const allowedTools = new Set<McpToolName>(
    (options.tools ?? ALL_MCP_TOOLS).filter((t) => {
      if (options.readOnly && WRITE_MCP_TOOLS.includes(t)) {
        return false;
      }
      return true;
    })
  );

  let pluginCtx: PluginContext;

  return definePlugin({
    id: 'mcp',
    options,
    init(ctx) {
      pluginCtx = ctx;
    },
    endpoints: {
      mcpInfo: {
        method: 'GET',
        path: `${mcpPath}/info`,
        openapi: {
          summary: 'MCP server metadata',
          description: 'Returns MCP server capabilities and status',
          tags: ['MCP'],
        },
        handler: () => ({
          name: 'better-payment-mcp',
          version: '1.0.0',
          protocolVersion: '2024-11-05',
          status: 'running',
          tools: Array.from(allowedTools),
        }),
      },
      mcpRpc: {
        method: 'POST',
        path: mcpPath,
        openapi: {
          summary: 'MCP JSON-RPC endpoint',
          description:
            'Handles standard Model Context Protocol JSON-RPC requests (tools/list, tools/call)',
          tags: ['MCP'],
        },
        handler: async (ctx) => {
          const body = (ctx.body ?? {}) as {
            jsonrpc?: string;
            id?: string | number | null;
            method?: string;
            params?: Record<string, unknown>;
          };

          const id = body.id ?? null;
          const method = body.method;

          // 1. Initialize
          if (method === 'initialize') {
            return ctx.json({
              jsonrpc: '2.0',
              id,
              result: {
                protocolVersion: '2024-11-05',
                serverInfo: {
                  name: 'better-payment-mcp',
                  version: '1.0.0',
                },
                capabilities: {
                  tools: {},
                },
              },
            });
          }

          // 2. Notification initialized
          if (method === 'notifications/initialized') {
            return ctx.json({ jsonrpc: '2.0', id, result: {} });
          }

          // 3. Tools list
          if (method === 'tools/list') {
            const toolsList = Array.from(allowedTools).map((name) => ({
              name,
              description: TOOL_DEFINITIONS[name].description,
              inputSchema: TOOL_DEFINITIONS[name].inputSchema,
            }));
            return ctx.json({
              jsonrpc: '2.0',
              id,
              result: {
                tools: toolsList,
              },
            });
          }

          // 4. Tools call
          if (method === 'tools/call') {
            const toolName = (body.params?.name as McpToolName) ?? '';
            const args = (body.params?.arguments ?? {}) as Record<string, unknown>;

            if (!allowedTools.has(toolName)) {
              return ctx.json(
                {
                  jsonrpc: '2.0',
                  id,
                  error: {
                    code: -32601,
                    message: `Tool '${toolName}' not found or disabled`,
                  },
                },
                404
              );
            }

            // Authorization check
            const isWrite = WRITE_MCP_TOOLS.includes(toolName);
            if (options.authorize) {
              const isAuthorized = await options.authorize(ctx.request);
              if (!isAuthorized) {
                return ctx.json(
                  {
                    jsonrpc: '2.0',
                    id,
                    error: {
                      code: -32001,
                      message: `Unauthorized: access to tool '${toolName}' was denied`,
                    },
                  },
                  403
                );
              }
            } else if (isWrite) {
              return ctx.json(
                {
                  jsonrpc: '2.0',
                  id,
                  error: {
                    code: -32001,
                    message: `Tool '${toolName}' is a write operation and requires an authorize option`,
                  },
                },
                403
              );
            }

            const providerId =
              (args.provider as string) ??
              pluginCtx.defaultProvider ??
              (pluginCtx.providerIds.length > 0 ? pluginCtx.providerIds[0] : 'default');

            const provider = pluginCtx.use(providerId);
            let executionResult: unknown;

            try {
              switch (toolName) {
                case 'getPayment': {
                  executionResult = await provider.getPayment(String(args.paymentId));
                  break;
                }
                case 'binCheck': {
                  executionResult = await provider.binCheck(String(args.binNumber));
                  break;
                }
                case 'installmentInfo': {
                  executionResult = await provider.installmentInfo({
                    binNumber: String(args.binNumber),
                    price: String(args.price),
                    conversationId: args.conversationId ? String(args.conversationId) : undefined,
                  });
                  break;
                }
                case 'refund': {
                  executionResult = await provider.refund({
                    paymentId: String(args.paymentId),
                    price: String(args.price),
                    currency: (args.currency as string) ?? 'TRY',
                    conversationId: args.conversationId as string | undefined,
                    ip: '127.0.0.1',
                  });
                  break;
                }
                case 'cancel': {
                  executionResult = await provider.cancel({
                    paymentId: String(args.paymentId),
                    conversationId: args.conversationId as string | undefined,
                    ip: '127.0.0.1',
                  });
                  break;
                }
              }

              const safeResult = sanitizeOutput(executionResult);

              options.onToolCall?.({
                tool: toolName,
                args,
                result: safeResult,
                timestamp: Date.now(),
              });

              return ctx.json({
                jsonrpc: '2.0',
                id,
                result: {
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify(safeResult, null, 2),
                    },
                  ],
                },
              });
            } catch (err: unknown) {
              options.onToolCall?.({
                tool: toolName,
                args,
                error: err,
                timestamp: Date.now(),
              });

              return ctx.json({
                jsonrpc: '2.0',
                id,
                error: {
                  code: -32000,
                  message: err instanceof Error ? err.message : String(err),
                },
              });
            }
          }

          // Unknown method
          return ctx.json(
            {
              jsonrpc: '2.0',
              id,
              error: {
                code: -32601,
                message: `Method '${method}' not found`,
              },
            },
            404
          );
        },
      },
    },
  });
}
