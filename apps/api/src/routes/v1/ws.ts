import type { FastifyInstance } from "fastify";
// WebSocket is provided at runtime by @fastify/websocket; use a minimal inline type
// to avoid requiring @types/ws as a separate devDependency.
interface WebSocket {
  send(data: string): void;
  ping(): void;
  readyState: number;
  OPEN: number;
  on(event: "close" | "error", listener: (err?: Error) => void): this;
}

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

      socket.on("error", (err?: Error) => {
        app.log.error({ err, machineIds }, "WebSocket error");
      });
    }
  );
}
