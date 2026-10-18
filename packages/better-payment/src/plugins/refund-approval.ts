import {
  BetterPaymentError,
  ConfigurationError,
  definePlugin,
  PaymentStatus,
  type BetterPaymentPlugin,
  type CancelRequest,
  type CancelResponse,
  type PluginContext,
  type RefundRequest,
  type RefundResponse,
} from 'better-payment';

export interface RefundApprovalRequest {
  id: string;
  operation: 'refund' | 'cancel';
  provider: string;
  paymentId: string;
  amount: number;
  currency: string;
  requestedBy?: string | Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected';
  request: RefundRequest | CancelRequest;
  createdAt: number;
  approvedAt?: number;
  approvedBy?: string | Record<string, unknown>;
  rejectedAt?: number;
  rejectedBy?: string | Record<string, unknown>;
  rejectionReason?: string;
}

export interface RefundApprovalStore {
  save(request: RefundApprovalRequest): Promise<void> | void;
  get(id: string): Promise<RefundApprovalRequest | undefined> | RefundApprovalRequest | undefined;
  list(filter?: { status?: 'pending' | 'approved' | 'rejected' }):
    | Promise<RefundApprovalRequest[]>
    | RefundApprovalRequest[];
  delete(id: string): Promise<void> | void;
}

export class MemoryRefundApprovalStore implements RefundApprovalStore {
  private readonly items = new Map<string, RefundApprovalRequest>();

  save(request: RefundApprovalRequest): void {
    this.items.set(request.id, { ...request });
  }

  get(id: string): RefundApprovalRequest | undefined {
    const item = this.items.get(id);
    return item ? { ...item } : undefined;
  }

  list(filter?: { status?: 'pending' | 'approved' | 'rejected' }): RefundApprovalRequest[] {
    let all = Array.from(this.items.values());
    if (filter?.status) {
      all = all.filter((r) => r.status === filter.status);
    }
    return all.map((r) => ({ ...r }));
  }

  delete(id: string): void {
    this.items.delete(id);
  }
}

export interface RefundApprovalOptions {
  /** Monetary threshold above which refunds require approval (in primary currency units, e.g. 1000) */
  threshold: number;
  /** Custom storage for approval requests. Default: in-memory store */
  store?: RefundApprovalStore;
  /** Function determining whether a user is authorized to approve refunds */
  approvers?: (user: unknown) => boolean | Promise<boolean>;
  /** Optional notification hook called when a new approval request is created */
  notify?: (request: RefundApprovalRequest) => Promise<void> | void;
}

function getUserId(user: unknown): string | undefined {
  if (!user) return undefined;
  if (typeof user === 'string') return user;
  if (typeof user === 'object') {
    const obj = user as Record<string, unknown>;
    return (obj.id as string) ?? (obj.userId as string) ?? (obj.username as string) ?? (obj.email as string);
  }
  return String(user);
}

/**
 * Refund approval workflow plugin for better-payment.
 *
 * Holds refunds and cancellations above a specified threshold in a pending queue
 * until reviewed and approved by an authorized manager or finance teammate.
 * Enforces separation of duties so requesters cannot approve their own refunds.
 *
 * @example
 * ```ts
 * import { refundApproval } from 'better-payment/plugins';
 *
 * const payment = betterPayment({
 *   providers: { ... },
 *   plugins: [
 *     refundApproval({
 *       threshold: 1000,
 *       approvers: (user) => user.role === 'finance',
 *       notify: async (req) => notifySlack(req),
 *     }),
 *   ],
 * });
 *
 * // Approve:
 * await payment.refunds.approve(approvalId, { by: currentUser });
 * ```
 */
export function refundApproval(options: RefundApprovalOptions): BetterPaymentPlugin {
  if (typeof options.threshold !== 'number' || options.threshold < 0) {
    throw new ConfigurationError(
      `refundApproval: threshold must be a non-negative number, got ${options.threshold}`
    );
  }

  const store = options.store ?? new MemoryRefundApprovalStore();
  const threshold = options.threshold;
  let pluginCtx: PluginContext;

  const approve = async (
    id: string,
    actionOptions: { by: unknown }
  ): Promise<RefundResponse | CancelResponse> => {
    const item = await store.get(id);
    if (!item) {
      throw new BetterPaymentError(`Approval request '${id}' not found`, 'INVALID_REQUEST');
    }
    if (item.status !== 'pending') {
      throw new BetterPaymentError(
        `Approval request '${id}' is already ${item.status}`,
        'INVALID_REQUEST'
      );
    }

    const requesterId = getUserId(item.requestedBy);
    const approverId = getUserId(actionOptions.by);

    if (requesterId && approverId && requesterId === approverId) {
      throw new BetterPaymentError(
        'Requester cannot approve their own refund request',
        'REFUND_SELF_APPROVAL_FORBIDDEN'
      );
    }

    if (options.approvers && !(await options.approvers(actionOptions.by))) {
      throw new BetterPaymentError(
        'User is not authorized to approve refunds',
        'REFUND_NOT_AUTHORIZED'
      );
    }

    const provider = pluginCtx.use(item.provider);
    let result: RefundResponse | CancelResponse;

    (item.request as Record<string, unknown>).__approved = true;
    if (item.operation === 'refund') {
      result = await provider.refund(item.request as RefundRequest);
    } else {
      result = await provider.cancel(item.request as CancelRequest);
    }

    item.status = 'approved';
    item.approvedAt = Date.now();
    item.approvedBy = actionOptions.by as string | Record<string, unknown>;
    await store.save(item);

    return result;
  };

  const reject = async (
    id: string,
    actionOptions: { by: unknown; reason?: string }
  ): Promise<RefundApprovalRequest> => {
    const item = await store.get(id);
    if (!item) {
      throw new BetterPaymentError(`Approval request '${id}' not found`, 'INVALID_REQUEST');
    }
    if (item.status !== 'pending') {
      throw new BetterPaymentError(
        `Approval request '${id}' is already ${item.status}`,
        'INVALID_REQUEST'
      );
    }

    if (options.approvers && !(await options.approvers(actionOptions.by))) {
      throw new BetterPaymentError(
        'User is not authorized to reject refunds',
        'REFUND_NOT_AUTHORIZED'
      );
    }

    item.status = 'rejected';
    item.rejectedAt = Date.now();
    item.rejectedBy = actionOptions.by;
    item.rejectionReason = actionOptions.reason;
    await store.save(item);

    return item;
  };

  return definePlugin({
    id: 'refund-approval',
    options,
    $ERROR_CODES: {
      REFUND_APPROVAL_REQUIRED: 'Refund requires approval from an authorized manager',
      REFUND_SELF_APPROVAL_FORBIDDEN: 'Requester cannot approve their own refund request',
      REFUND_NOT_AUTHORIZED: 'User is not authorized to approve refunds',
    },
    init: (ctx) => {
      pluginCtx = ctx;
    },
    hooks: {
      before: [
        {
          matcher: (ctx) => ctx.operation === 'refund' || ctx.operation === 'cancel',
          handler: async (ctx) => {
            const req = ctx.request as Record<string, unknown>;
            if (req.__approved) {
              return;
            }

            const rawPrice = req.price ?? req.amount;
            const amount = typeof rawPrice === 'string' ? parseFloat(rawPrice) : Number(rawPrice ?? 0);

            // If below threshold, allow direct execution without approval
            if (amount <= threshold) {
              return;
            }

            const id = `apr_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
            const requestedBy = req.requestedBy ?? req.by ?? req.userId;

            const approvalRecord: RefundApprovalRequest = {
              id,
              operation: ctx.operation as 'refund' | 'cancel',
              provider: ctx.provider ?? 'default',
              paymentId: (req.paymentId as string) ?? '',
              amount,
              currency: (req.currency as string) ?? 'TRY',
              requestedBy: requestedBy as string | Record<string, unknown>,
              status: 'pending',
              request: ctx.request as RefundRequest | CancelRequest,
              createdAt: Date.now(),
            };

            await store.save(approvalRecord);

            if (options.notify) {
              try {
                await options.notify(approvalRecord);
              } catch (notifyErr) {
                pluginCtx.logger?.error('refundApproval: notify callback failed', notifyErr as Error);
              }
            }

            return {
              result: {
                status: PaymentStatus.PENDING,
                code: 'REFUND_APPROVAL_REQUIRED',
                errorCode: 'REFUND_APPROVAL_REQUIRED',
                errorMessage: 'Refund requires approval from an authorized manager',
                approvalId: id,
                paymentId: req.paymentId,
                conversationId: req.conversationId,
              },
            };
          },
        },
      ],
    },
    methods: (ctx) => {
      pluginCtx = ctx;
      return {
        refunds: {
          /** Approves a pending refund request and executes the refund on the provider */
          approve,
          /** Rejects and drops a pending refund request */
          reject,
          /** Lists refund approval requests */
          list: (filter?: { status?: 'pending' | 'approved' | 'rejected' }) => store.list(filter),
          /** Retrieves a specific approval request */
          get: (id: string) => store.get(id),
          /** The storage backend */
          store,
        },
      };
    },
    endpoints: {
      pendingRefunds: {
        method: 'GET',
        path: '/refunds/pending',
        privileged: true,
        handler: async (ctx) => {
          pluginCtx = ctx;
          return await store.list({ status: 'pending' });
        },
      },
      approveRefund: {
        method: 'POST',
        path: '/refunds/approve',
        privileged: true,
        handler: async (ctx) => {
          pluginCtx = ctx;
          const body = (ctx.body ?? {}) as { id?: string; by?: unknown };
          if (!body.id) {
            return ctx.json({ status: 'error', errorMessage: 'Missing required field: id' }, 400);
          }
          const result = await approve(body.id, { by: body.by });
          return ctx.json(result);
        },
      },
      rejectRefund: {
        method: 'POST',
        path: '/refunds/reject',
        privileged: true,
        handler: async (ctx) => {
          pluginCtx = ctx;
          const body = (ctx.body ?? {}) as { id?: string; by?: unknown; reason?: string };
          if (!body.id) {
            return ctx.json({ status: 'error', errorMessage: 'Missing required field: id' }, 400);
          }
          const result = await reject(body.id, { by: body.by, reason: body.reason });
          return ctx.json(result);
        },
      },
    },
  });
}
