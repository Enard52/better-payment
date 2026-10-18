import { describe, it, expect, vi } from 'vitest';
import { betterPayment, PaymentStatus } from 'better-payment';
import { MockProvider, MOCK_CARDS } from 'better-payment/testing';
import { mcp } from 'better-payment/plugins';
import { mockPaymentRequest } from '../../fixtures/payment-data';

describe('mcp plugin', () => {
  it('handles MCP initialize and tools/list requests', async () => {
    const payment = betterPayment({
      providers: { mock: new MockProvider() },
      plugins: [
        mcp({
          path: '/mcp',
        }),
      ],
      handler: {
        basePath: '/api/pay',
      },
    });

    // 1. initialize
    const initRes = await payment.handler.handle({
      method: 'POST',
      url: 'http://localhost/api/pay/mcp',
      headers: { 'content-type': 'application/json' },
      body: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
      },
    });

    expect(initRes.status).toBe(200);
    const initBody = initRes.body as Record<string, unknown>;
    expect(initBody.jsonrpc).toBe('2.0');
    expect(initBody.id).toBe(1);
    const initResult = initBody.result as Record<string, unknown>;
    expect(initResult.protocolVersion).toBe('2024-11-05');
    expect((initResult.serverInfo as Record<string, unknown>).name).toBe('better-payment-mcp');

    // 2. tools/list
    const listRes = await payment.handler.handle({
      method: 'POST',
      url: 'http://localhost/api/pay/mcp',
      headers: { 'content-type': 'application/json' },
      body: {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
      },
    });

    expect(listRes.status).toBe(200);
    const listBody = listRes.body as Record<string, unknown>;
    const tools = (listBody.result as { tools: { name: string; description: string }[] }).tools;
    expect(tools.length).toBeGreaterThanOrEqual(4);
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain('getPayment');
    expect(toolNames).toContain('binCheck');
    expect(toolNames).toContain('installmentInfo');
    expect(toolNames).toContain('refund');
  });

  it('executes read-only query tools (binCheck and getPayment)', async () => {
    const onToolCall = vi.fn();
    const mockProvider = new MockProvider();

    const payment = betterPayment({
      providers: { mock: mockProvider },
      plugins: [
        mcp({
          path: '/mcp',
          onToolCall,
        }),
      ],
      handler: {
        basePath: '/api/pay',
      },
    });

    // Create a payment first to query
    const created = await payment.createPayment(mockPaymentRequest);
    expect(created.status).toBe(PaymentStatus.SUCCESS);

    // Call getPayment tool
    const queryRes = await payment.handler.handle({
      method: 'POST',
      url: 'http://localhost/api/pay/mcp',
      headers: { 'content-type': 'application/json' },
      body: {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'getPayment',
          arguments: {
            paymentId: created.paymentId,
          },
        },
      },
    });

    expect(queryRes.status).toBe(200);
    const queryBody = queryRes.body as Record<string, unknown>;
    const content = (queryBody.result as { content: { type: string; text: string }[] }).content;
    expect(content[0].type).toBe('text');
    const resultObj = JSON.parse(content[0].text);
    expect(resultObj.paymentId).toBe(created.paymentId);
    expect(resultObj.status).toBe(PaymentStatus.SUCCESS);

    expect(onToolCall).toHaveBeenCalledTimes(1);
    expect(onToolCall.mock.calls[0][0].tool).toBe('getPayment');
  });

  it('blocks unauthorized write tools (refund) and allows when authorized', async () => {
    const payment = betterPayment({
      providers: { mock: new MockProvider() },
      plugins: [
        mcp({
          path: '/mcp',
          authorize: (req) => {
            return req.headers['authorization'] === 'Bearer valid_agent_token';
          },
        }),
      ],
      handler: {
        basePath: '/api/pay',
      },
    });

    // Create payment first so MockProvider has a settled payment to refund
    const created = await payment.createPayment({
      ...mockPaymentRequest,
      price: '100.00',
      paidPrice: '100.00',
    });
    expect(created.status).toBe(PaymentStatus.SUCCESS);

    // 1. Without authorization header -> rejected
    const unauthRes = await payment.handler.handle({
      method: 'POST',
      url: 'http://localhost/api/pay/mcp',
      headers: { 'content-type': 'application/json' },
      body: {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'refund',
          arguments: {
            paymentId: created.paymentId,
            price: '50.00',
          },
        },
      },
    });

    expect(unauthRes.status).toBe(403);
    const unauthBody = unauthRes.body as Record<string, unknown>;
    expect((unauthBody.error as Record<string, unknown>).code).toBe(-32001);

    // 2. With valid authorization header -> authorized
    const authRes = await payment.handler.handle({
      method: 'POST',
      url: 'http://localhost/api/pay/mcp',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer valid_agent_token',
      },
      body: {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: {
          name: 'refund',
          arguments: {
            paymentId: created.paymentId,
            price: '50.00',
          },
        },
      },
    });

    expect(authRes.status).toBe(200);
    const authBody = authRes.body as Record<string, unknown>;
    expect(authBody.result).toBeDefined();
  });

  it('readOnly mode hides write tools and refuses write execution', async () => {
    const payment = betterPayment({
      providers: { mock: new MockProvider() },
      plugins: [
        mcp({
          path: '/mcp',
          readOnly: true,
        }),
      ],
      handler: {
        basePath: '/api/pay',
      },
    });

    // List tools in readOnly mode
    const listRes = await payment.handler.handle({
      method: 'POST',
      url: 'http://localhost/api/pay/mcp',
      headers: { 'content-type': 'application/json' },
      body: {
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/list',
      },
    });

    const tools = (listRes.body as { result: { tools: { name: string }[] } }).result.tools;
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain('getPayment');
    expect(toolNames).not.toContain('refund');
    expect(toolNames).not.toContain('cancel');

    // Attempting to call refund in readOnly mode returns 404
    const callRes = await payment.handler.handle({
      method: 'POST',
      url: 'http://localhost/api/pay/mcp',
      headers: { 'content-type': 'application/json' },
      body: {
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: {
          name: 'refund',
          arguments: { paymentId: 'pay_123', price: '10.00' },
        },
      },
    });

    expect(callRes.status).toBe(404);
  });
});
