/**
 * Production Schedule routes — GST-108
 *
 * Endpoints:
 *   GET    /api/v1/production-schedules          — list (any authenticated user)
 *   GET    /api/v1/production-schedules/:id      — get single (any authenticated user)
 *   POST   /api/v1/production-schedules          — create (supervisor/admin)
 *   PATCH  /api/v1/production-schedules/:id      — update / status transition (supervisor/admin)
 *   DELETE /api/v1/production-schedules/:id      — delete draft/cancelled only (supervisor/admin)
 *
 * Machine overlap validation returns 409 Conflict.
 * Status transitions enforced: draft → confirmed → active → completed|cancelled
 */

import type { FastifyInstance, FastifyReply } from "fastify";
import { createDb } from "@mes/db";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import {
  ScheduleService,
  type IScheduleService,
  type ScheduleStatus,
} from "../../services/ScheduleService.js";

// ─── Status transition table ─────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<ScheduleStatus, ScheduleStatus[]> = {
  draft: ["confirmed", "cancelled"],
  confirmed: ["active", "cancelled"],
  active: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

// ─── Plugin ──────────────────────────────────────────────────────────────────

export default async function productionScheduleRoutes(
  app: FastifyInstance,
  options: { scheduleService?: IScheduleService }
) {
  // Lazy-init service — use injected mock in tests, real DB in production.
  let svc: IScheduleService | null = options.scheduleService ?? null;

  function getService(reply: FastifyReply): IScheduleService | null {
    if (svc) return svc;
    if (!process.env["DATABASE_URL"]) {
      reply.status(503).send({
        statusCode: 503,
        error: "Service Unavailable",
        message: "Database not configured",
      });
      return null;
    }
    svc = new ScheduleService(createDb());
    return svc;
  }

  // ─── GET /api/v1/production-schedules ──────────────────────────────────────

  app.get<{
    Querystring: {
      workOrderId?: string;
      machineId?: string;
      status?: string;
      from?: string;
      to?: string;
    };
  }>(
    "/production-schedules",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["Production Schedules"],
        summary: "List production schedules",
        querystring: {
          type: "object",
          properties: {
            workOrderId: { type: "string" },
            machineId: { type: "string" },
            status: {
              type: "string",
              enum: ["draft", "confirmed", "active", "completed", "cancelled"],
            },
            from: { type: "string", description: "ISO 8601 — scheduledStart >= from" },
            to: { type: "string", description: "ISO 8601 — scheduledStart < to" },
          },
        },
        response: { 200: { type: "array" } },
      },
    },
    async (request, reply) => {
      const service = getService(reply);
      if (!service) return;

      const { workOrderId, machineId, status, from, to } = request.query;

      const fromDate = from ? new Date(from) : undefined;
      const toDate = to ? new Date(to) : undefined;

      if (fromDate && isNaN(fromDate.getTime())) {
        return reply.status(400).send({ message: "Invalid 'from' date" });
      }
      if (toDate && isNaN(toDate.getTime())) {
        return reply.status(400).send({ message: "Invalid 'to' date" });
      }

      return service.list({ workOrderId, machineId, status, from: fromDate, to: toDate });
    }
  );

  // ─── GET /api/v1/production-schedules/:id ──────────────────────────────────

  app.get<{ Params: { id: string } }>(
    "/production-schedules/:id",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["Production Schedules"],
        summary: "Get a production schedule by ID",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
    },
    async (request, reply) => {
      const service = getService(reply);
      if (!service) return;

      const schedule = await service.getById(request.params.id);
      if (!schedule) {
        return reply.status(404).send({ message: "Production schedule not found" });
      }
      return schedule;
    }
  );

  // ─── POST /api/v1/production-schedules ─────────────────────────────────────

  app.post<{
    Body: {
      workOrderId: string;
      machineId: string;
      scheduledStart: string;
      scheduledEnd: string;
      lineId?: string;
      sequenceNumber?: number;
      shiftId?: string;
      operatorId?: string;
      status?: ScheduleStatus;
      notes?: string;
    };
  }>(
    "/production-schedules",
    {
      preHandler: requireRole(["supervisor", "admin"]),
      schema: {
        tags: ["Production Schedules"],
        summary: "Create a production schedule slot",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          required: ["workOrderId", "machineId", "scheduledStart", "scheduledEnd"],
          properties: {
            workOrderId: { type: "string" },
            machineId: { type: "string" },
            scheduledStart: { type: "string", format: "date-time" },
            scheduledEnd: { type: "string", format: "date-time" },
            lineId: { type: "string" },
            sequenceNumber: { type: "number" },
            shiftId: { type: "string" },
            operatorId: { type: "string" },
            status: {
              type: "string",
              enum: ["draft", "confirmed", "active", "completed", "cancelled"],
            },
            notes: { type: "string" },
          },
        },
        response: {
          400: { type: "object", properties: { message: { type: "string" } } },
          409: { type: "object", properties: { message: { type: "string" }, conflictId: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      const service = getService(reply);
      if (!service) return;

      const {
        workOrderId,
        machineId,
        scheduledStart: startStr,
        scheduledEnd: endStr,
        lineId,
        sequenceNumber,
        shiftId,
        operatorId,
        status,
        notes,
      } = request.body;

      const scheduledStart = new Date(startStr);
      const scheduledEnd = new Date(endStr);

      if (isNaN(scheduledStart.getTime()) || isNaN(scheduledEnd.getTime())) {
        return reply.status(400).send({ message: "Invalid scheduledStart or scheduledEnd" });
      }
      if (scheduledStart >= scheduledEnd) {
        return reply.status(400).send({
          message: "scheduledStart must be before scheduledEnd",
        });
      }

      const conflict = await service.checkMachineOverlap(
        machineId,
        scheduledStart,
        scheduledEnd
      );
      if (conflict) {
        return reply.status(409).send({
          message: `Machine ${machineId} is already scheduled from ${conflict.scheduledStart.toISOString()} to ${conflict.scheduledEnd.toISOString()} (schedule ${conflict.id})`,
          conflictId: conflict.id,
        });
      }

      const schedule = await service.create({
        workOrderId,
        machineId,
        scheduledStart,
        scheduledEnd,
        lineId: lineId ?? null,
        sequenceNumber: sequenceNumber ?? 0,
        shiftId: shiftId ?? null,
        operatorId: operatorId ?? null,
        status: status ?? "draft",
        notes: notes ?? null,
      });

      return reply.status(201).send(schedule);
    }
  );

  // ─── PATCH /api/v1/production-schedules/:id ────────────────────────────────

  app.patch<{
    Params: { id: string };
    Body: {
      machineId?: string;
      scheduledStart?: string;
      scheduledEnd?: string;
      lineId?: string | null;
      sequenceNumber?: number;
      shiftId?: string | null;
      operatorId?: string | null;
      status?: ScheduleStatus;
      notes?: string | null;
    };
  }>(
    "/production-schedules/:id",
    {
      preHandler: requireRole(["supervisor", "admin"]),
      schema: {
        tags: ["Production Schedules"],
        summary: "Update a production schedule (status transitions and field updates)",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        body: {
          type: "object",
          properties: {
            machineId: { type: "string" },
            scheduledStart: { type: "string", format: "date-time" },
            scheduledEnd: { type: "string", format: "date-time" },
            lineId: { type: ["string", "null"] },
            sequenceNumber: { type: "number" },
            shiftId: { type: ["string", "null"] },
            operatorId: { type: ["string", "null"] },
            status: {
              type: "string",
              enum: ["draft", "confirmed", "active", "completed", "cancelled"],
            },
            notes: { type: ["string", "null"] },
          },
        },
        response: {
          400: { type: "object", properties: { message: { type: "string" } } },
          404: { type: "object", properties: { message: { type: "string" } } },
          409: { type: "object", properties: { message: { type: "string" }, conflictId: { type: "string" } } },
          422: { type: "object", properties: { message: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      const service = getService(reply);
      if (!service) return;

      const { id } = request.params;
      const current = await service.getById(id);
      if (!current) {
        return reply.status(404).send({ message: "Production schedule not found" });
      }

      const {
        machineId,
        scheduledStart: startStr,
        scheduledEnd: endStr,
        lineId,
        sequenceNumber,
        shiftId,
        operatorId,
        status,
        notes,
      } = request.body;

      // ── Status transition validation ────────────────────────────────────────
      if (status !== undefined && status !== current.status) {
        const allowed = VALID_TRANSITIONS[current.status];
        if (!allowed.includes(status)) {
          return reply.status(422).send({
            message: `Cannot transition from '${current.status}' to '${status}'. Allowed: ${allowed.join(", ") || "none"}`,
          });
        }
      }

      // ── Parse updated time window ───────────────────────────────────────────
      const scheduledStart = startStr ? new Date(startStr) : current.scheduledStart;
      const scheduledEnd = endStr ? new Date(endStr) : current.scheduledEnd;

      if (startStr && isNaN(scheduledStart.getTime())) {
        return reply.status(400).send({ message: "Invalid scheduledStart" });
      }
      if (endStr && isNaN(scheduledEnd.getTime())) {
        return reply.status(400).send({ message: "Invalid scheduledEnd" });
      }
      if (scheduledStart >= scheduledEnd) {
        return reply.status(400).send({
          message: "scheduledStart must be before scheduledEnd",
        });
      }

      // ── Overlap check when machine or time window changes ──────────────────
      const effectiveMachineId = machineId ?? current.machineId;
      const timeWindowChanged =
        startStr !== undefined ||
        endStr !== undefined ||
        (machineId !== undefined && machineId !== current.machineId);

      if (timeWindowChanged) {
        const conflict = await service.checkMachineOverlap(
          effectiveMachineId,
          scheduledStart,
          scheduledEnd,
          id
        );
        if (conflict) {
          return reply.status(409).send({
            message: `Machine ${effectiveMachineId} is already scheduled from ${conflict.scheduledStart.toISOString()} to ${conflict.scheduledEnd.toISOString()} (schedule ${conflict.id})`,
            conflictId: conflict.id,
          });
        }
      }

      // ── Build update payload ────────────────────────────────────────────────
      const updateData: Record<string, unknown> = {};
      if (machineId !== undefined) updateData.machineId = machineId;
      if (startStr !== undefined) updateData.scheduledStart = scheduledStart;
      if (endStr !== undefined) updateData.scheduledEnd = scheduledEnd;
      if (lineId !== undefined) updateData.lineId = lineId;
      if (sequenceNumber !== undefined) updateData.sequenceNumber = sequenceNumber;
      if (shiftId !== undefined) updateData.shiftId = shiftId;
      if (operatorId !== undefined) updateData.operatorId = operatorId;
      if (status !== undefined) updateData.status = status;
      if (notes !== undefined) updateData.notes = notes;

      const updated = await service.update(id, updateData);
      return updated;
    }
  );

  // ─── DELETE /api/v1/production-schedules/:id ───────────────────────────────

  app.delete<{ Params: { id: string } }>(
    "/production-schedules/:id",
    {
      preHandler: requireRole(["supervisor", "admin"]),
      schema: {
        tags: ["Production Schedules"],
        summary: "Delete a production schedule (draft or cancelled only)",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        response: {
          204: { type: "null" },
          404: { type: "object", properties: { message: { type: "string" } } },
          422: { type: "object", properties: { message: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      const service = getService(reply);
      if (!service) return;

      const { id } = request.params;
      const current = await service.getById(id);
      if (!current) {
        return reply.status(404).send({ message: "Production schedule not found" });
      }

      if (current.status !== "draft" && current.status !== "cancelled") {
        return reply.status(422).send({
          message: `Cannot delete a schedule with status '${current.status}'. Only draft or cancelled schedules may be deleted.`,
        });
      }

      await service.delete(id);
      return reply.status(204).send();
    }
  );
}
