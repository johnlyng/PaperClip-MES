import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { IERPAdapter } from "@mes/domain/erp";
import type { WorkOrder, ProductionResult, UserRole } from "@mes/types";

/**
 * ERP integration routes — wired via app.ts with the active IERPAdapter.
 *
 * POST /api/v1/erp/sync
 *   Pulls open production orders from the ERP for the next 30 days and
 *   upserts them into the local work order store. No auth required (internal
 *   operation triggered by scheduler or operator dashboard).
 *
 * POST /api/v1/erp/confirm/:workOrderId
 *   Posts completion data back to the ERP when a work order is closed.
 *   Requires JWT + role in {supervisor, engineer, admin} — confirmation is
 *   a financial/audit action in discrete manufacturing.
 *
 * GET /api/v1/erp/health
 *   Lightweight connectivity check — delegates to IERPAdapter.healthCheck().
 *   Used by the E2E gate (Step 8) and monitoring dashboards.
 */

/** Roles permitted to post a production confirmation back to the ERP */
const CONFIRM_ALLOWED_ROLES: UserRole[] = ["supervisor", "engineer", "admin"];

/** JWT payload shape — must match the token issued by /auth/login */
interface JwtPayload {
  sub: string;
  role: UserRole;
  username?: string;
}

/** preHandler that verifies the JWT and enforces the confirmation role allowlist */
async function requireConfirmRole(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send({
      statusCode: 401,
      error: "Unauthorized",
      message: "A valid JWT is required",
    });
  }

  const user = request.user as JwtPayload;
  if (!CONFIRM_ALLOWED_ROLES.includes(user.role)) {
    return reply.status(403).send({
      statusCode: 403,
      error: "Forbidden",
      message: `Role '${user.role}' is not permitted to post ERP confirmations. ` +
        `Required: ${CONFIRM_ALLOWED_ROLES.join(", ")}`,
    });
  }
}

export default async function erpRoutes(
  app: FastifyInstance,
  options: { erpAdapter: IERPAdapter; workOrderStore: WorkOrder[] }
) {
  const { erpAdapter, workOrderStore } = options;

  // ─── POST /api/v1/erp/sync ──────────────────────────────────────────────────

  app.post("/erp/sync", {
    schema: {
      tags: ["ERP"],
      summary: "Sync production orders from ERP into MES",
      description:
        "Pulls open SAP Production Orders for the next 30 days and creates " +
        "corresponding Work Orders in the MES. Existing work orders with the " +
        "same erpReference are skipped (no duplicate creation).",
      response: {
        200: {
          type: "object",
          properties: {
            synced: { type: "number" },
            skipped: { type: "number" },
            workOrders: { type: "array" },
          },
        },
        502: { type: "object" },
      },
    },
  }, async (_request, reply) => {
    const from = new Date();
    const to = new Date(from.getTime() + 30 * 24 * 60 * 60 * 1000); // +30 days

    let erpOrders: WorkOrder[];
    try {
      erpOrders = await erpAdapter.getWorkOrdersByDate(from, to);
    } catch (err) {
      app.log.error({ err }, "ERP sync: failed to fetch production orders");
      return reply.status(502).send({
        statusCode: 502,
        error: "Bad Gateway",
        message: "Failed to fetch production orders from ERP",
      });
    }

    let synced = 0;
    let skipped = 0;
    const syncedOrders: WorkOrder[] = [];

    for (const erpOrder of erpOrders) {
      // Orders without an erpReference cannot be deduped — creating them would
      // produce unbounded duplicates on every sync. Skip and warn so the issue
      // is visible in logs rather than silently inflating the store.
      if (erpOrder.erpReference == null) {
        app.log.warn(
          { workOrderNumber: erpOrder.workOrderNumber },
          "ERP sync: order has no erpReference — skipping to prevent undeduplicable duplicates"
        );
        skipped++;
        continue;
      }

      // Dedup by erpReference — don't create a duplicate WO for the same SAP order.
      const exists = workOrderStore.some(
        (wo) => wo.erpReference === erpOrder.erpReference
      );
      if (exists) {
        skipped++;
        continue;
      }

      const now = new Date();
      const wo: WorkOrder = {
        ...erpOrder,
        id: `erp-${erpOrder.workOrderNumber}-${Date.now()}`,
        // Force draft — ERP orders enter MES in draft state; supervisors release them.
        status: "draft",
        createdAt: now,
        updatedAt: now,
      };
      workOrderStore.push(wo);
      syncedOrders.push(wo);
      synced++;
    }

    app.log.info({ synced, skipped }, "ERP sync complete");
    return reply.send({ synced, skipped, workOrders: syncedOrders });
  });

  // ─── POST /api/v1/erp/confirm/:workOrderId ──────────────────────────────────

  app.post<{
    Params: { workOrderId: string };
    Body: {
      machineId?: string;
      operatorId?: string;
      actualQuantity: number;
      scrapQuantity: number;
      notes?: string;
    };
  }>("/erp/confirm/:workOrderId", {
    preHandler: [requireConfirmRole],
    schema: {
      tags: ["ERP"],
      summary: "Post completion data back to ERP for a closed work order",
      description:
        "When a Work Order is completed in the MES, this endpoint posts the " +
        "production result (actual qty, scrap, operator) back to SAP as a " +
        "Production Order Confirmation (TECO). Requires supervisor/engineer/admin role.",
      security: [{ bearerAuth: [] }],
      params: {
        type: "object",
        properties: { workOrderId: { type: "string" } },
        required: ["workOrderId"],
      },
      body: {
        type: "object",
        properties: {
          machineId: { type: "string" },
          operatorId: { type: "string" },
          actualQuantity: { type: "number", minimum: 0 },
          scrapQuantity: { type: "number", minimum: 0 },
          notes: { type: "string" },
        },
        required: ["actualQuantity", "scrapQuantity"],
      },
      response: {
        200: {
          type: "object",
          properties: {
            workOrderId: { type: "string" },
            confirmed: { type: "boolean" },
          },
        },
        400: { type: "object" },
        401: { type: "object" },
        403: { type: "object" },
        404: { type: "object" },
        422: { type: "object" },
        502: { type: "object" },
      },
    },
  }, async (request, reply) => {
    const { workOrderId } = request.params;
    const wo = workOrderStore.find((w) => w.id === workOrderId);

    if (!wo) {
      return reply.status(404).send({
        statusCode: 404,
        error: "Not Found",
        message: `Work order ${workOrderId} not found`,
      });
    }

    if (wo.status !== "completed") {
      return reply.status(422).send({
        statusCode: 422,
        error: "Unprocessable Entity",
        message: `Work order ${workOrderId} is not completed (status: ${wo.status})`,
      });
    }

    // Validate quantities against the work order's planned quantity
    const { actualQuantity, scrapQuantity } = request.body;
    if (actualQuantity < 0 || scrapQuantity < 0) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: "Negative quantities are invalid",
      });
    }
    if (actualQuantity + scrapQuantity > wo.quantity) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message:
          `actualQuantity (${actualQuantity}) + scrapQuantity (${scrapQuantity}) ` +
          `must not exceed work order quantity (${wo.quantity})`,
      });
    }

    const result: ProductionResult = {
      workOrderId: wo.erpReference ?? workOrderId,
      machineId: request.body.machineId ?? wo.machineId ?? "unknown",
      operatorId: request.body.operatorId ?? wo.operatorId,
      actualQuantity,
      scrapQuantity,
      completedAt: wo.actualEnd ?? new Date(),
      notes: request.body.notes,
    };

    try {
      await erpAdapter.pushProductionResult(result);
    } catch (err) {
      app.log.error({ err, workOrderId }, "ERP confirm: failed to push production result");
      return reply.status(502).send({
        statusCode: 502,
        error: "Bad Gateway",
        message: "Failed to post confirmation to ERP",
      });
    }

    app.log.info({ workOrderId, erpReference: wo.erpReference }, "ERP confirmation posted");
    return reply.send({ workOrderId, confirmed: true });
  });

  // ─── GET /api/v1/erp/health ─────────────────────────────────────────────────
  // Delegates to IERPAdapter.healthCheck() — used by E2E gate Step 8 and monitoring.

  app.get("/erp/health", {
    schema: {
      tags: ["ERP"],
      summary: "ERP adapter connectivity check",
      response: {
        200: {
          type: "object",
          properties: {
            connected: { type: "boolean" },
            latency: { type: "number" },
          },
        },
        503: { type: "object" },
      },
    },
  }, async (_request, reply) => {
    try {
      const health = await erpAdapter.healthCheck();
      return health;
    } catch {
      return reply.status(503).send({ connected: false, latency: -1 });
    }
  });
}
