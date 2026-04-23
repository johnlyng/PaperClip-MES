import type { FastifyInstance } from "fastify";
import { MACHINES } from "@mes/test-fixtures";
import type { Machine } from "@mes/types";

// Stub in-memory store — replace with Drizzle + PostgreSQL in GST-8
const store: Machine[] = [...MACHINES];

export default async function machineRoutes(app: FastifyInstance) {
  // GET /api/v1/machines
  app.get("/machines", {
    schema: { tags: ["Machines"], summary: "List all machines" },
  }, async () => store);

  // GET /api/v1/machines/:id
  app.get<{ Params: { id: string } }>("/machines/:id", {
    schema: {
      tags: ["Machines"],
      summary: "Get a machine by ID",
      params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    },
  }, async (request, reply) => {
    const machine = store.find((m) => m.id === request.params.id);
    if (!machine) return reply.status(404).send({ message: "Machine not found" });
    return machine;
  });

  // GET /api/v1/machines/:id/oee
  app.get<{ Params: { id: string }; Querystring: { from?: string; to?: string; granularity?: string } }>(
    "/machines/:id/oee",
    {
      schema: {
        tags: ["Machines"],
        summary: "Get OEE metrics for a machine",
        params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        querystring: {
          type: "object",
          properties: {
            from: { type: "string" },
            to: { type: "string" },
            granularity: { type: "string", enum: ["1m", "1h", "1d"] },
          },
        },
      },
    },
    async (_request, _reply) => {
      // Stub — real implementation queries TimescaleDB continuous aggregates
      return { message: "OEE endpoint stub — implement with TimescaleDB continuous aggregates" };
    }
  );
}
