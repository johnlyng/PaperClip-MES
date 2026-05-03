import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import websocket from "@fastify/websocket";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { MqttSubscriber } from "./services/mqtt-subscriber.js";
import { createDb } from "@mes/db";
import { MockERPAdapter, SAPAdapter, sapConfigFromEnv } from "@mes/domain/erp";
import { workOrderStore } from "./stores/work-orders.js";

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

  // ─── MQTT telemetry subscriber ─────────────────────────────────────────────
  // Connects to EMQX on startup, subscribes to mes/telemetry/#, and writes
  // every MqttTelemetryPayload into the machine_telemetry TimescaleDB hypertable.
  // Skipped when DATABASE_URL or MQTT_URL is absent (test / CI environments).

  let mqttSubscriber: MqttSubscriber | null = null;

  app.addHook("onReady", async () => {
    if (!process.env["DATABASE_URL"]) {
      app.log.warn("DATABASE_URL not set — MQTT subscriber skipped");
      return;
    }
    if (process.env["NODE_ENV"] === "test") {
      return; // integration tests spin up their own MQTT container
    }
    try {
      const db = createDb();
      mqttSubscriber = new MqttSubscriber(db, app.log);
      await mqttSubscriber.connect();
      app.log.info("MQTT telemetry subscriber started");
    } catch (err) {
      // Non-fatal: API still serves OEE queries from existing DB data
      app.log.error({ err }, "MQTT subscriber failed to start — telemetry ingestion disabled");
    }
  });

  app.addHook("onClose", async () => {
    if (mqttSubscriber) {
      await mqttSubscriber.disconnect();
    }
  });

  // ─── ERP Adapter ───────────────────────────────────────────────────────────
  // Select SAPAdapter when SAP_BASE_URL is set, fall back to MockERPAdapter.
  // ERP_ADAPTER=mock forces the mock adapter even if SAP_BASE_URL is present.

  const erpAdapterType = process.env["ERP_ADAPTER"] ?? "auto";
  const erpAdapter =
    erpAdapterType === "mock" || !process.env["SAP_BASE_URL"]
      ? new MockERPAdapter()
      : new SAPAdapter(sapConfigFromEnv());

  app.log.info(
    { adapterType: erpAdapter instanceof SAPAdapter ? "sap" : "mock" },
    "ERP adapter selected"
  );

  // ─── Routes ────────────────────────────────────────────────────────────────

  app.get("/health", async () => ({ status: "ok", ts: new Date().toISOString() }));

  // v1 routes registered as async plugins
  app.register(import("./routes/v1/auth.js"), { prefix: "/api/v1" });
  app.register(import("./routes/v1/work-orders.js"), { prefix: "/api/v1" });
  app.register(import("./routes/v1/machines.js"), { prefix: "/api/v1" });
  app.register(import("./routes/v1/ws.js"), { prefix: "/api/v1" });
  app.register(import("./routes/v1/erp.js"), {
    prefix: "/api/v1",
    erpAdapter,
    workOrderStore,
  });
  app.register(import("./routes/v1/resource-assignments.js"), { prefix: "/api/v1" });

  return app;
}
