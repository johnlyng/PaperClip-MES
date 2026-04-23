import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";

/**
 * WebSocket route for real-time telemetry.
 * GET /api/v1/ws/telemetry?machineIds=machine-001,machine-002
 *
 * The server pushes MachineTelemetry payloads as JSON to connected clients.
 * Clients should implement exponential backoff reconnect logic (see ADR-001 §2).
 */
export default async function wsRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { machineIds?: string } }>(
    "/ws/telemetry",
    { websocket: true },
    (socket: WebSocket, request) => {
      const machineIds = request.query.machineIds?.split(",").filter(Boolean) ?? [];

      app.log.info({ machineIds }, "WebSocket client connected to telemetry feed");

      socket.send(JSON.stringify({
        type: "connected",
        machineIds,
        ts: new Date().toISOString(),
      }));

      // Keep-alive ping every 30 seconds
      const ping = setInterval(() => {
        if (socket.readyState === socket.OPEN) {
          socket.ping();
        }
      }, 30_000);

      socket.on("close", () => {
        clearInterval(ping);
        app.log.info({ machineIds }, "WebSocket client disconnected from telemetry feed");
      });

      socket.on("error", (err) => {
        app.log.error({ err, machineIds }, "WebSocket error");
      });
    }
  );
}
