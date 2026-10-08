import { Router } from 'express';
import { handler, ok, parseBody, parseQuery, listQuery, page } from '../lib/http.js';
import { context } from '../lib/context.js';
import { prisma } from '../db/client.js';
import {
  pullChanges,
  pullRequestSchema,
  pushOperations,
  pushRequestSchema,
  syncOverview,
} from '../modules/sync/sync.service.js';
import { requirePermission } from '../middleware/index.js';

/**
 * Offline synchronisation endpoints.
 *
 * These are on the critical path for a disconnected till, so they are tuned for
 * that case rather than for elegance:
 *
 *   * `allowExpired` on authentication, because a terminal that has been dark
 *     all night cannot refresh its access token — but its session row is still
 *     valid, and that is what actually authorises the request.
 *   * No aggressive rate limiting beyond the global limiter. A till coming back
 *     online legitimately pushes a large backlog at once, and throttling it
 *     would just prolong the window where money is unacknowledged.
 *   * Per-item results always, so one bad sale in a batch of two hundred never
 *     costs the cashier the other hundred and ninety-nine.
 */

export const syncRouter = Router();

syncRouter.post(
  '/push',
  handler(async (req, res) => {
    const input = parseBody(pushRequestSchema, req);
    ok(res, await pushOperations(input));
  }),
);

syncRouter.post(
  '/pull',
  handler(async (req, res) => {
    const input = parseBody(pullRequestSchema, req);
    ok(res, await pullChanges(input));
  }),
);

/** Operator view: which devices have synced, and what is stuck. */
syncRouter.get(
  '/overview',
  requirePermission('sync:view'),
  handler(async (req, res) => {
    const ctx = context();
    ok(res, await syncOverview(ctx.businessId));
  }),
);

/** Paginated journal of everything ingested from terminals. */
syncRouter.get(
  '/operations',
  requirePermission('sync:view'),
  handler(async (req, res) => {
    const ctx = context();
    const { skip, take } = listQuery(req);
    const q = req.query as Record<string, string | undefined>;

    const where: Record<string, unknown> = { businessId: ctx.businessId };
    if (q.deviceId) where.deviceId = q.deviceId;
    if (q.status) where.status = q.status;
    if (q.type) where.type = q.type;

    const [rows, total] = await Promise.all([
      prisma.syncOperation.findMany({
        where,
        orderBy: { processedAt: 'desc' },
        skip,
        take,
        select: {
          id: true, deviceId: true, clientTxnId: true, type: true, status: true,
          resultType: true, resultRef: true, message: true, capturedAt: true,
          processedAt: true, attempts: true,
        },
      }),
      prisma.syncOperation.count({ where }),
    ]);

    page(res, rows, total, Number(q.page) || 1, Number(q.pageSize) || 25);
  }),
);

/** A single operation's full payload, for adjudicating a disputed sale. */
syncRouter.get(
  '/operations/:clientTxnId',
  requirePermission('sync:view'),
  handler(async (req, res) => {
    const ctx = context();
    const operation = await prisma.syncOperation.findFirst({
      where: { clientTxnId: String(req.params.clientTxnId), businessId: ctx.businessId },
    });
    ok(res, operation ?? null);
  }),
);
