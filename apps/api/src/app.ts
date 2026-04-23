import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import websocket from "@fastify/websocket";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";

export function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
  });

  // ─── Plugins ───────────────────────────────────────────────────────────────

  app.register(cors, {
    origin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  });

  app.register(jwt, {
    secret: process.env.JWT_SECRET ?? "dev-only-secret",
  });

  app.register(websocket);

  app.register(swagger, {
    openapi: {
      info: {
        title: "MES API",
        description: "Manufacturing Execution System REST + WebSocket API",
        version: "1.0.0",
      },
      servers: [{ url: "http://localhost:3000" }],
      components: {
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        },
      },
    },
  });

  app.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: { docExpansion: "list" },
  });

  // ─── Routes ────────────────────────────────────────────────────────────────

  app.get("/health", async () => ({ status: "ok", ts: new Date().toISOString() }));

  // v1 routes registered as async plugins
  app.register(import("./routes/v1/work-orders.js"), { prefix: "/api/v1" });
  app.register(import("./routes/v1/machines.js"), { prefix: "/api/v1" });
  app.register(import("./routes/v1/ws.js"), { prefix: "/api/v1" });

  return app;
}
