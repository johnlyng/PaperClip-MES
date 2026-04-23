/**
 * Health check HTTP server — liveness probe for Docker / k8s.
 *
 * GET /health → 200 { status: "ok" }
 *
 * Uses Node.js built-in `http` — no extra dependencies.
 * Port defaults to 9090; override with HEALTH_PORT env var.
 */

import { createServer, type Server } from "node:http";
import { createLogger } from "./logger.js";

const log = createLogger("health");

export function startHealthServer(): Server {
  const port = parseInt(process.env["HEALTH_PORT"] ?? "9090", 10);

  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      const body = JSON.stringify({ status: "ok" });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(body);
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(port, () => {
    log.info({ port }, "Health server listening");
  });

  return server;
}
