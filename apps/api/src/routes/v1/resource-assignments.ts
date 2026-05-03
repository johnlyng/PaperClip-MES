import type { FastifyInstance } from "fastify";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { resourceAssignmentStore, type ResourceAssignment, type ResourceType } from "../../stores/resource-assignments.js";
import { workOrderStore } from "../../stores/work-orders.js";

const RESOURCE_TYPES = ["machine", "operator", "tool", "material"] as const;

export default async function resourceAssignmentRoutes(app: FastifyInstance) {
  // GET /api/v1/work-orders/:workOrderId/resource-assignments — any authenticated user
  app.get<{ Params: { workOrderId: string } }>(
    "/work-orders/:workOrderId/resource-assignments",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["Resource Assignments"],
        summary: "List all resource assignments for a work order",
        params: {
          type: "object",
          properties: { workOrderId: { type: "string" } },
          required: ["workOrderId"],
        },
        response: { 200: { type: "array" } },
      },
    },
    async (request, reply) => {
      const { workOrderId } = request.params;
      const wo = workOrderStore.find((w) => w.id === workOrderId);
      if (!wo) return reply.status(404).send({ message: "Work order not found" });
      return resourceAssignmentStore.filter((a) => a.workOrderId === workOrderId);
    }
  );

  // POST /api/v1/work-orders/:workOrderId/resource-assignments — supervisor or admin only
  app.post<{
    Params: { workOrderId: string };
    Body: {
      resourceType: ResourceType;
      resourceId: string;
      quantity?: number;
      unit?: string;
      scheduledStart?: string;
      scheduledEnd?: string;
      notes?: string;
    };
  }>(
    "/work-orders/:workOrderId/resource-assignments",
    {
      preHandler: requireRole(["supervisor", "admin"]),
      schema: {
        tags: ["Resource Assignments"],
        summary: "Create a resource assignment for a work order",
        params: {
          type: "object",
          properties: { workOrderId: { type: "string" } },
          required: ["workOrderId"],
        },
        body: {
          type: "object",
          properties: {
            resourceType: { type: "string", enum: [...RESOURCE_TYPES] },
            resourceId: { type: "string" },
            quantity: { type: "number" },
            unit: { type: "string" },
            scheduledStart: { type: "string" },
            scheduledEnd: { type: "string" },
            notes: { type: "string" },
          },
          required: ["resourceType", "resourceId"],
        },
      },
    },
    async (request, reply) => {
      const { workOrderId } = request.params;
      const wo = workOrderStore.find((w) => w.id === workOrderId);
      if (!wo) return reply.status(404).send({ message: "Work order not found" });

      const now = new Date();
      const { resourceType, resourceId, quantity, unit, scheduledStart, scheduledEnd, notes } = request.body;

      const assignment: ResourceAssignment = {
        id: `ra-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        workOrderId,
        resourceType,
        resourceId,
        quantity: quantity ?? 1,
        unit: unit ?? null,
        scheduledStart: scheduledStart ? new Date(scheduledStart) : null,
        scheduledEnd: scheduledEnd ? new Date(scheduledEnd) : null,
        notes: notes ?? null,
        createdAt: now,
        updatedAt: now,
      };

      resourceAssignmentStore.push(assignment);
      return reply.status(201).send(assignment);
    }
  );

  // PATCH /api/v1/resource-assignments/:id — supervisor or admin only
  app.patch<{
    Params: { id: string };
    Body: {
      quantity?: number;
      unit?: string;
      scheduledStart?: string | null;
      scheduledEnd?: string | null;
      notes?: string | null;
    };
  }>(
    "/resource-assignments/:id",
    {
      preHandler: requireRole(["supervisor", "admin"]),
      schema: {
        tags: ["Resource Assignments"],
        summary: "Update quantity, unit, scheduled window, or notes for an assignment",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        body: {
          type: "object",
          properties: {
            quantity: { type: "number" },
            unit: { type: "string" },
            scheduledStart: { type: ["string", "null"] },
            scheduledEnd: { type: ["string", "null"] },
            notes: { type: ["string", "null"] },
          },
        },
      },
    },
    async (request, reply) => {
      const assignment = resourceAssignmentStore.find((a) => a.id === request.params.id);
      if (!assignment) return reply.status(404).send({ message: "Resource assignment not found" });

      const { quantity, unit, scheduledStart, scheduledEnd, notes } = request.body;

      if (quantity !== undefined) assignment.quantity = quantity;
      if (unit !== undefined) assignment.unit = unit;
      if (scheduledStart !== undefined) {
        assignment.scheduledStart = scheduledStart ? new Date(scheduledStart) : null;
      }
      if (scheduledEnd !== undefined) {
        assignment.scheduledEnd = scheduledEnd ? new Date(scheduledEnd) : null;
      }
      if (notes !== undefined) assignment.notes = notes;
      assignment.updatedAt = new Date();

      return assignment;
    }
  );

  // DELETE /api/v1/resource-assignments/:id — supervisor or admin only
  app.delete<{ Params: { id: string } }>(
    "/resource-assignments/:id",
    {
      preHandler: requireRole(["supervisor", "admin"]),
      schema: {
        tags: ["Resource Assignments"],
        summary: "Remove a resource assignment",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        response: { 204: { type: "null" } },
      },
    },
    async (request, reply) => {
      const idx = resourceAssignmentStore.findIndex((a) => a.id === request.params.id);
      if (idx === -1) return reply.status(404).send({ message: "Resource assignment not found" });

      resourceAssignmentStore.splice(idx, 1);
      return reply.status(204).send();
    }
  );
}
