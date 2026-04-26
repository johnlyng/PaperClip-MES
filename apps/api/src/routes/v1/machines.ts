import type { FastifyInstance } from "fastify";
import { MACHINES } from "@mes/test-fixtures";
import type { Machine } from "@mes/types";
import { OEEQueryService } from "../../services/oee-query.js";
import { createDb } from "@mes/db";

// Stub in-memory store — replace with Drizzle + PostgreSQL machines table in GST-8
const store: Machine[] = [...MACHINES];

/** Per-machine ideal output rate (units/min) used for Performance calculation.
 *  In production this would come from the machines table or ERP BOM data.
 *  Zero / undefined = fall back to Availability for Performance (conservative). */
const IDEAL_RATE_PER_MIN: Record<string, number> = {
  "machine-mock-001": 10,    // CNC Lathe Alpha: 10 pcs/min
  "machine-mock-002": 8,     // Milling Station Beta: 8 pcs/min
  "machine-mock-003": 15,    // Assembly Robot Gamma: 15 pcs/min
  "machine-cnc-001": 0.25,   // CNC Lathe Alpha (Line A): 1 unit / 4.0 min = 0.25 pcs/min (GST-29)
  "machine-reactor-001": 2,  // Batch Reactor R-101: 2 kg/min
  "machine-reactor-002": 5,  // Continuous Mixer CM-201: 5 L/min
  "machine-dryer-001": 3,    // Spray Dryer SD-301: 3 kg/min
};

export default async function machineRoutes(app: FastifyInstance) {
  // Lazy-initialise DB + OEE service (only when DATABASE_URL is available)
  let oeeService: OEEQueryService | null = null;
  function getOEEService(): OEEQueryService {
    if (!oeeService) {
      const db = createDb();
      oeeService = new OEEQueryService(db);
    }
    return oeeService;
  }

  // ─── GET /api/v1/machines ──────────────────────────────────────────────
  app.get("/machines", {
    schema: {
      tags: ["Machines"],
      summary: "List all machines",
      response: { 200: { type: "array" } },
    },
  }, async () => store);

  // ─── GET /api/v1/machines/:id ──────────────────────────────────────────
  app.get<{ Params: { id: string } }>("/machines/:id", {
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
    const machine = store.find((m) => m.id === request.params.id);
    if (!machine) return reply.status(404).send({ message: "Machine not found" });
    return machine;
  });

  // ─── GET /api/v1/machines/:id/oee ─────────────────────────────────────
  /**
   * Query OEE metrics for a specific machine over a time range.
   *
   * Query parameters:
   *   from         — ISO 8601 start datetime (required)
   *   to           — ISO 8601 end datetime (default: now)
   *   granularity  — "1m" | "1h" | "1d" (default: "1h")
   *
   * Returns an array of OEESnapshot objects, one per time bucket.
   *
   * Acceptance criteria:
   *   AC-OEE-01: OEE % = availability × performance × quality
   *   AC-OEE-02: Telemetry persisted to TimescaleDB hypertable
   *   AC-OEE-03: Aggregates available per shift via continuous aggregates
   */
  app.get<{
    Params: { id: string };
    Querystring: { from?: string; to?: string; granularity?: string };
  }>(
    "/machines/:id/oee",
    {
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
        const snapshots = await getOEEService().queryOEE({
          machineId: id,
          from: fromDate,
          to: toDate,
          granularity: gran,
          idealRatePerMin: IDEAL_RATE_PER_MIN[id],
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

  // ─── GET /api/v1/machines/:id/oee/summary ────────────────────────────
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
        const summary = await getOEEService().queryOEESummary(
          id,
          fromDate,
          toDate,
          IDEAL_RATE_PER_MIN[id]
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
