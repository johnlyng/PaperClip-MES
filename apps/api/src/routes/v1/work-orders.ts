import type { FastifyInstance } from "fastify";
import { WorkOrderStateMachine } from "@mes/domain";
import type { WorkOrder, WorkOrderStatus } from "@mes/types";
import { workOrderStore as store } from "../../stores/work-orders.js";

export default async function workOrderRoutes(app: FastifyInstance) {
  // GET /api/v1/work-orders
  app.get("/work-orders", {
    schema: {
      tags: ["Work Orders"],
      summary: "List all work orders",
      response: { 200: { type: "array" } },
    },
  }, async () => store);

  // GET /api/v1/work-orders/:id
  app.get<{ Params: { id: string } }>("/work-orders/:id", {
    schema: {
      tags: ["Work Orders"],
      summary: "Get a work order by ID",
      params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    },
  }, async (request, reply) => {
    const wo = store.find((w) => w.id === request.params.id);
    if (!wo) return reply.status(404).send({ message: "Work order not found" });
    return wo;
  });

  // POST /api/v1/work-orders
  app.post<{ Body: Omit<WorkOrder, "id" | "createdAt" | "updatedAt"> }>("/work-orders", {
    schema: {
      tags: ["Work Orders"],
      summary: "Create a new work order",
      body: { type: "object" },
    },
  }, async (request, reply) => {
    const now = new Date();
    // Cast to Partial so TypeScript doesn't flag duplicate keys from the spread.
    // Caller may omit required fields (e.g. process WOs use scheduledQuantity /
    // targetMachineId aliases), so we supply safe defaults before the spread.
    const body = request.body as Partial<WorkOrder>;
    const wo: WorkOrder = {
      status: "draft" as WorkOrderStatus,
      workOrderNumber: `WO-${Date.now()}`,
      title: "Work Order",
      productId: "unknown",
      quantity: 0,
      unit: "pcs",
      priority: 0,
      scheduledStart: now,
      scheduledEnd: now,
      ...body,
      id: `wo-${Date.now()}`,
      createdAt: now,
      updatedAt: now,
    };
    store.push(wo);
    return reply.status(201).send(wo);
  });

  // PATCH /api/v1/work-orders/:id/transition
  app.patch<{ Params: { id: string }; Body: { event: string } }>(
    "/work-orders/:id/transition",
    {
      schema: {
        tags: ["Work Orders"],
        summary: "Transition a work order to a new state",
        params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        body: { type: "object", properties: { event: { type: "string" } }, required: ["event"] },
      },
    },
    async (request, reply) => {
      const wo = store.find((w) => w.id === request.params.id);
      if (!wo) return reply.status(404).send({ message: "Work order not found" });

      try {
        const nextStatus = WorkOrderStateMachine.apply(
          wo.status,
          request.body.event as Parameters<typeof WorkOrderStateMachine.apply>[1]
        );
        wo.status = nextStatus;
        wo.updatedAt = new Date();
        if (nextStatus === "in_progress" && !wo.actualStart) wo.actualStart = new Date();
        if (nextStatus === "completed") wo.actualEnd = new Date();
        return wo;
      } catch (err) {
        return reply.status(422).send({ message: (err as Error).message });
      }
    }
  );
}
