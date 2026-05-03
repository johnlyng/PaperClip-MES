import type { FastifyInstance } from "fastify";
import { eq, asc } from "drizzle-orm";
import { createDb, machines as machinesTable } from "@mes/db";
import type { Machine, MachineStatus } from "@mes/types";
import { OEEQueryService } from "../../services/oee-query.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CreateMachineBody {
  id: string;
  name: string;
  description?: string;
  type?: string;
  lineId?: string;
  idealRatePerMin?: number;
  status?: MachineStatus;
  metadata?: Record<string, unknown>;
}

interface UpdateMachineBody {
  name?: string;
  description?: string;
  type?: string;
  lineId?: string;
  idealRatePerMin?: number | null;
  status?: MachineStatus;
  metadata?: Record<string, unknown>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Map a Drizzle row to the @mes/types Machine shape */
function rowToMachine(row: typeof machinesTable.$inferSelect): Machine {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    type: row.type ?? undefined,
    lineId: row.lineId ?? undefined,
    idealRatePerMin: row.idealRatePerMin,
    status: row.status as MachineStatus,
    metadata: (row.metadata as Record<string, unknown>) ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ─── Route plugin ─────────────────────────────────────────────────────────────

export default async function machineRoutes(app: FastifyInstance) {
  // Lazy-initialise DB + OEE service (only when DATABASE_URL is available)
  let db: ReturnType<typeof createDb> | null = null;
  let oeeService: OEEQueryService | null = null;

  function getDb() {
    if (!db) db = createDb();
    return db;
  }

  function getOEEService(): OEEQueryService {
    if (!oeeService) oeeService = new OEEQueryService(getDb());
    return oeeService;
  }

  // ─── GET /api/v1/machines ──────────────────────────────────────────────────
  app.get("/machines", {
    preHandler: requireAuth,
    schema: {
      tags: ["Machines"],
      summary: "List all machines",
      response: { 200: { type: "array" } },
    },
  }, async () => {
    const rows = await getDb()
      .select()
      .from(machinesTable)
      .orderBy(asc(machinesTable.name));
    return rows.map(rowToMachine);
  });

  // ─── GET /api/v1/machines/:id ──────────────────────────────────────────────
  app.get<{ Params: { id: string } }>("/machines/:id", {
    preHandler: requireAuth,
    schema: {
      tags: ["Machines"],
      summary: "Get a machine by ID",
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  }, async (request, reply) => {
    const rows = await getDb()
      .select()
      .from(machinesTable)
      .where(eq(machinesTable.id, request.params.id))
      .limit(1);
    if (rows.length === 0) return reply.status(404).send({ message: "Machine not found" });
    return rowToMachine(rows[0]!);
  });

  // ─── POST /api/v1/machines ─────────────────────────────────────────────────
  app.post<{ Body: CreateMachineBody }>("/machines", {
    preHandler: requireRole(["admin"]),
    schema: {
      tags: ["Machines"],
      summary: "Create a new machine (admin only)",
      body: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
          type: { type: "string" },
          lineId: { type: "string" },
          idealRatePerMin: { type: "number" },
          status: { type: "string", enum: ["running", "idle", "fault", "maintenance", "disconnected"] },
          metadata: { type: "object" },
        },
        required: ["id", "name"],
      },
      response: {
        201: { type: "object" },
        409: { type: "object", properties: { message: { type: "string" } } },
      },
    },
  }, async (request, reply) => {
    const body = request.body;

    // Check for duplicate ID
    const existing = await getDb()
      .select({ id: machinesTable.id })
      .from(machinesTable)
      .where(eq(machinesTable.id, body.id))
      .limit(1);
    if (existing.length > 0) {
      return reply.status(409).send({ message: `Machine '${body.id}' already exists` });
    }

    const rows = await getDb()
      .insert(machinesTable)
      .values({
        id: body.id,
        name: body.name,
        description: body.description ?? null,
        type: body.type ?? null,
        lineId: body.lineId ?? null,
        idealRatePerMin: body.idealRatePerMin ?? null,
        status: (body.status ?? "disconnected") as MachineStatus,
        metadata: body.metadata ?? {},
      })
      .returning();

    return reply.status(201).send(rowToMachine(rows[0]!));
  });

  // ─── PATCH /api/v1/machines/:id ────────────────────────────────────────────
  app.patch<{ Params: { id: string }; Body: UpdateMachineBody }>("/machines/:id", {
    preHandler: requireRole(["admin"]),
    schema: {
      tags: ["Machines"],
      summary: "Update a machine (admin only)",
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
      body: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          type: { type: "string" },
          lineId: { type: "string" },
          idealRatePerMin: { type: ["number", "null"] },
          status: { type: "string", enum: ["running", "idle", "fault", "maintenance", "disconnected"] },
          metadata: { type: "object" },
        },
      },
      response: {
        200: { type: "object" },
        404: { type: "object", properties: { message: { type: "string" } } },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const body = request.body;

    // Build partial update — only include fields that were explicitly provided
    const update: Partial<typeof machinesTable.$inferInsert> = {};
    if (body.name !== undefined) update.name = body.name;
    if (body.description !== undefined) update.description = body.description;
    if (body.type !== undefined) update.type = body.type;
    if (body.lineId !== undefined) update.lineId = body.lineId;
    if ("idealRatePerMin" in body) update.idealRatePerMin = body.idealRatePerMin ?? null;
    if (body.status !== undefined) update.status = body.status as MachineStatus;
    if (body.metadata !== undefined) update.metadata = body.metadata;

    if (Object.keys(update).length === 0) {
      return reply.status(400).send({ message: "No updatable fields provided" });
    }

    const rows = await getDb()
      .update(machinesTable)
      .set(update)
      .where(eq(machinesTable.id, id))
      .returning();

    if (rows.length === 0) return reply.status(404).send({ message: "Machine not found" });
    return rowToMachine(rows[0]!);
  });

  // ─── DELETE /api/v1/machines/:id ───────────────────────────────────────────
  app.delete<{ Params: { id: string } }>("/machines/:id", {
    preHandler: requireRole(["admin"]),
    schema: {
      tags: ["Machines"],
      summary: "Delete a machine (admin only)",
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
      response: {
        204: { type: "null" },
        404: { type: "object", properties: { message: { type: "string" } } },
      },
    },
  }, async (request, reply) => {
    const rows = await getDb()
      .delete(machinesTable)
      .where(eq(machinesTable.id, request.params.id))
      .returning({ id: machinesTable.id });

    if (rows.length === 0) return reply.status(404).send({ message: "Machine not found" });
    return reply.status(204).send();
  });

  // ─── GET /api/v1/machines/:id/oee ─────────────────────────────────────────
  /**
   * Query OEE metrics for a specific machine over a time range.
   *
   * Query parameters:
   *   from         — ISO 8601 start datetime (required)
   *   to           — ISO 8601 end datetime (default: now)
   *   granularity  — "1m" | "1h" | "1d" (default: "1h")
   *
   * idealRatePerMin is loaded from the machines table so it stays in sync with
   * any admin edits — no more hardcoded IDEAL_RATE_PER_MIN constant.
   */
  app.get<{
    Params: { id: string };
    Querystring: { from?: string; to?: string; granularity?: string };
  }>(
    "/machines/:id/oee",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["Machines", "OEE"],
        summary: "Get OEE time-series for a machine",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        querystring: {
          type: "object",
          properties: {
            from: { type: "string", description: "ISO 8601 start time (required)" },
            to: { type: "string", description: "ISO 8601 end time (default: now)" },
            granularity: {
              type: "string",
              enum: ["1m", "1h", "1d"],
              description: "Time bucket granularity (default: 1h)",
            },
          },
          required: [],
        },
        response: {
          200: {
            type: "array",
            items: {
              type: "object",
              properties: {
                machineId: { type: "string" },
                windowStart: { type: "string" },
                windowEnd: { type: "string" },
                granularity: { type: "string" },
                availability: { type: "number" },
                performance: { type: "number" },
                quality: { type: "number" },
                oee: { type: "number" },
                plannedProductionTime: { type: "number" },
                actualProductionTime: { type: "number" },
                goodCount: { type: "number" },
                totalCount: { type: "number" },
              },
            },
          },
          400: { type: "object", properties: { message: { type: "string" } } },
          503: { type: "object", properties: { message: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { from, to, granularity } = request.query;

      if (!from) {
        return reply.status(400).send({ message: "Query parameter 'from' is required" });
      }

      const fromDate = new Date(from);
      const toDate = to ? new Date(to) : new Date();

      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        return reply.status(400).send({ message: "Invalid date format for 'from' or 'to'" });
      }
      if (fromDate >= toDate) {
        return reply.status(400).send({ message: "'from' must be before 'to'" });
      }

      const gran = (granularity ?? "1h") as "1m" | "1h" | "1d";

      try {
        // Load idealRatePerMin from DB so it reflects any admin edits
        const machineRows = await getDb()
          .select({ idealRatePerMin: machinesTable.idealRatePerMin })
          .from(machinesTable)
          .where(eq(machinesTable.id, id))
          .limit(1);
        const idealRatePerMin = machineRows[0]?.idealRatePerMin ?? undefined;

        const snapshots = await getOEEService().queryOEE({
          machineId: id,
          from: fromDate,
          to: toDate,
          granularity: gran,
          idealRatePerMin,
        });

        return snapshots.map((s) => ({
          machineId: s.machineId,
          windowStart: s.from.toISOString(),
          windowEnd: s.to.toISOString(),
          granularity: s.granularity,
          availability: s.availability,
          performance: s.performance,
          quality: s.quality,
          oee: s.oee,
          plannedProductionTime: s.plannedProductionTime,
          actualProductionTime: s.actualProductionTime,
          goodCount: s.goodCount,
          totalCount: s.totalCount,
        }));
      } catch (err) {
        app.log.error({ err, machineId: id }, "OEE query failed");
        return reply.status(503).send({ message: "OEE data temporarily unavailable" });
      }
    }
  );

  // ─── GET /api/v1/machines/:id/oee/summary ────────────────────────────────
  /**
   * Returns a single rolled-up OEE value for the entire time window.
   * Defaults to last 8 hours (one shift). Used by dashboard OEE gauge.
   */
  app.get<{
    Params: { id: string };
    Querystring: { from?: string; to?: string };
  }>(
    "/machines/:id/oee/summary",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["Machines", "OEE"],
        summary: "Get aggregated OEE summary for a machine (default: last shift)",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        querystring: {
          type: "object",
          properties: {
            from: { type: "string" },
            to: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const fromDate = request.query.from
        ? new Date(request.query.from)
        : new Date(Date.now() - 8 * 60 * 60 * 1000); // last 8h = one shift
      const toDate = request.query.to ? new Date(request.query.to) : new Date();

      try {
        // Load idealRatePerMin from DB
        const machineRows = await getDb()
          .select({ idealRatePerMin: machinesTable.idealRatePerMin })
          .from(machinesTable)
          .where(eq(machinesTable.id, id))
          .limit(1);
        const idealRatePerMin = machineRows[0]?.idealRatePerMin ?? undefined;

        const summary = await getOEEService().queryOEESummary(
          id,
          fromDate,
          toDate,
          idealRatePerMin
        );

        if (!summary) {
          return reply.status(404).send({
            message: "No OEE data found for this machine in the requested window",
          });
        }

        return {
          machineId: summary.machineId,
          windowStart: summary.from.toISOString(),
          windowEnd: summary.to.toISOString(),
          availability: summary.availability,
          performance: summary.performance,
          quality: summary.quality,
          oee: summary.oee,
          plannedProductionTime: summary.plannedProductionTime,
          actualProductionTime: summary.actualProductionTime,
          goodCount: summary.goodCount,
          totalCount: summary.totalCount,
        };
      } catch (err) {
        app.log.error({ err, machineId: id }, "OEE summary query failed");
        return reply.status(503).send({ message: "OEE data temporarily unavailable" });
      }
    }
  );
}
