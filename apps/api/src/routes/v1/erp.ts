import type { FastifyInstance } from "fastify";
import type { IERPAdapter } from "@mes/domain/erp";
import type { WorkOrder, ProductionResult } from "@mes/types";

/**
 * ERP integration routes — wired via app.ts with the active IERPAdapter.
 *
 * POST /api/v1/erp/sync
 *   Pulls open production orders from the ERP for the next 30 days and
 *   upserts them into the local in-memory work order store (placeholder until
 *   GST-25 migrates to PostgreSQL).
 *
 * POST /api/v1/erp/confirm/:workOrderId
 *   Posts completion data back to the ERP when a work order is closed.
 */
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
      // Dedup by erpReference — don't create a duplicate WO for the same SAP order
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
    schema: {
      tags: ["ERP"],
      summary: "Post completion data back to ERP for a closed work order",
      description:
        "When a Work Order is completed in the MES, this endpoint posts the " +
        "production result (actual qty, scrap, operator) back to SAP as a " +
        "Production Order Confirmation (TECO).",
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
          actualQuantity: { type: "number" },
          scrapQuantity: { type: "number" },
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

    const result: ProductionResult = {
      workOrderId: wo.erpReference ?? workOrderId,
      machineId: request.body.machineId ?? wo.machineId ?? "unknown",
      operatorId: request.body.operatorId ?? wo.operatorId,
      actualQuantity: request.body.actualQuantity,
      scrapQuantity: request.body.scrapQuantity,
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
}
