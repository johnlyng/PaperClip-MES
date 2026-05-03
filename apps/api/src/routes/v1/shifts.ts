/**
 * Shifts API — /api/v1/shifts
 *
 * GET    /api/v1/shifts           — list shifts (any authenticated user)
 * POST   /api/v1/shifts           — create shift (supervisor/admin)
 * PATCH  /api/v1/shifts/:id       — update shift (supervisor/admin)
 * DELETE /api/v1/shifts/:id       — deactivate shift (supervisor/admin; soft-delete)
 */

import type { FastifyInstance } from "fastify";
import type { CreateShiftPayload, UpdateShiftPayload } from "@mes/types";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { shiftStore } from "../../stores/shifts.js";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function validateTime(value: string, field: string): string | null {
  if (!TIME_RE.test(value)) {
    return `${field} must be in "HH:MM" 24-hour format`;
  }
  return null;
}

function validateDaysOfWeek(days: unknown): string | null {
  if (!Array.isArray(days) || days.length === 0) {
    return "daysOfWeek must be a non-empty array";
  }
  for (const d of days) {
    if (typeof d !== "number" || !Number.isInteger(d) || d < 0 || d > 6) {
      return "daysOfWeek entries must be integers 0–6 (0=Sun … 6=Sat)";
    }
  }
  return null;
}

export default async function shiftRoutes(app: FastifyInstance) {
  // GET /api/v1/shifts — any authenticated user
  // Optional query param: ?activeOnly=true (default) | ?activeOnly=false
  app.get<{ Querystring: { activeOnly?: string } }>("/shifts", {
    preHandler: requireAuth,
    schema: {
      tags: ["Shifts"],
      summary: "List shift definitions",
      querystring: {
        type: "object",
        properties: {
          activeOnly: { type: "string", enum: ["true", "false"] },
        },
      },
      response: { 200: { type: "array" } },
    },
  }, async (request) => {
    const activeOnly = request.query.activeOnly !== "false";
    return activeOnly ? shiftStore.filter((s) => s.isActive) : shiftStore;
  });

  // GET /api/v1/shifts/:id — any authenticated user
  app.get<{ Params: { id: string } }>("/shifts/:id", {
    preHandler: requireAuth,
    schema: {
      tags: ["Shifts"],
      summary: "Get a shift definition by ID",
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  }, async (request, reply) => {
    const shift = shiftStore.find((s) => s.id === request.params.id);
    if (!shift) return reply.status(404).send({ message: "Shift not found" });
    return shift;
  });

  // POST /api/v1/shifts — supervisor/admin only
  app.post<{ Body: CreateShiftPayload }>("/shifts", {
    preHandler: requireRole(["supervisor", "admin"]),
    schema: {
      tags: ["Shifts"],
      summary: "Create a new shift definition",
      body: {
        type: "object",
        required: ["name", "startTime", "endTime", "daysOfWeek"],
        properties: {
          name: { type: "string", minLength: 1 },
          startTime: { type: "string" },
          endTime: { type: "string" },
          daysOfWeek: { type: "array", items: { type: "number" } },
          isActive: { type: "boolean" },
        },
      },
    },
  }, async (request, reply) => {
    const { name, startTime, endTime, daysOfWeek, isActive = true } = request.body;

    const errors: string[] = [];
    const startErr = validateTime(startTime, "startTime");
    if (startErr) errors.push(startErr);
    const endErr = validateTime(endTime, "endTime");
    if (endErr) errors.push(endErr);
    const daysErr = validateDaysOfWeek(daysOfWeek);
    if (daysErr) errors.push(daysErr);
    if (!name.trim()) errors.push("name must not be blank");

    if (errors.length > 0) {
      return reply.status(400).send({ message: errors.join("; ") });
    }

    const now = new Date();
    const shift = {
      id: `shift-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: name.trim(),
      startTime,
      endTime,
      daysOfWeek,
      isActive,
      createdAt: now,
      updatedAt: now,
    };

    shiftStore.push(shift);
    return reply.status(201).send(shift);
  });

  // PATCH /api/v1/shifts/:id — supervisor/admin only
  app.patch<{ Params: { id: string }; Body: UpdateShiftPayload }>("/shifts/:id", {
    preHandler: requireRole(["supervisor", "admin"]),
    schema: {
      tags: ["Shifts"],
      summary: "Update a shift definition",
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
      body: {
        type: "object",
        properties: {
          name: { type: "string", minLength: 1 },
          startTime: { type: "string" },
          endTime: { type: "string" },
          daysOfWeek: { type: "array", items: { type: "number" } },
          isActive: { type: "boolean" },
        },
      },
    },
  }, async (request, reply) => {
    const shift = shiftStore.find((s) => s.id === request.params.id);
    if (!shift) return reply.status(404).send({ message: "Shift not found" });

    const { name, startTime, endTime, daysOfWeek, isActive } = request.body;

    const errors: string[] = [];
    if (startTime !== undefined) {
      const err = validateTime(startTime, "startTime");
      if (err) errors.push(err);
    }
    if (endTime !== undefined) {
      const err = validateTime(endTime, "endTime");
      if (err) errors.push(err);
    }
    if (daysOfWeek !== undefined) {
      const err = validateDaysOfWeek(daysOfWeek);
      if (err) errors.push(err);
    }
    if (name !== undefined && !name.trim()) {
      errors.push("name must not be blank");
    }

    if (errors.length > 0) {
      return reply.status(400).send({ message: errors.join("; ") });
    }

    if (name !== undefined) shift.name = name.trim();
    if (startTime !== undefined) shift.startTime = startTime;
    if (endTime !== undefined) shift.endTime = endTime;
    if (daysOfWeek !== undefined) shift.daysOfWeek = daysOfWeek;
    if (isActive !== undefined) shift.isActive = isActive;
    shift.updatedAt = new Date();

    return shift;
  });

  // DELETE /api/v1/shifts/:id — supervisor/admin only (soft-delete: sets isActive=false)
  app.delete<{ Params: { id: string } }>("/shifts/:id", {
    preHandler: requireRole(["supervisor", "admin"]),
    schema: {
      tags: ["Shifts"],
      summary: "Deactivate a shift (soft-delete; preserves FK history)",
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
      response: { 204: { type: "null" } },
    },
  }, async (request, reply) => {
    const shift = shiftStore.find((s) => s.id === request.params.id);
    if (!shift) return reply.status(404).send({ message: "Shift not found" });

    shift.isActive = false;
    shift.updatedAt = new Date();

    return reply.status(204).send();
  });
}
