/**
 * Scada-LTS Collector — entry point.
 *
 * ADR-001 Decision 7 (amended): Scada-LTS replaces OPC-UA as the SCADA
 * integration path. This service polls the Scada-LTS REST API and publishes
 * machine telemetry to EMQX via MQTT.
 *
 * Data flow:
 *   Scada-LTS REST API → DataPointPoller → MqttPublisher → EMQX
 *
 * Startup contract:
 *   1. Authenticate to Scada-LTS — exit 1 on failure (Docker will restart).
 *   2. Validate configured XIDs — warn if missing, do NOT crash.
 *   3. Start session keepalive, poll loops, and health check server.
 */

import { loadConfig } from "./config.js";
import { ScadaLTSAuthClient } from "./auth.js";
import { DataPointPoller } from "./poller.js";
import { MqttPublisher } from "./publisher.js";
import { startHealthServer } from "./health.js";
import { createLogger } from "./logger.js";

const log = createLogger("startup");

// ─── Load configuration ───────────────────────────────────────────────────────

const config = loadConfig();
log.info(
  { datapoints: config.datapoints.length, baseUrl: config.scadalts.baseUrl },
  "Config loaded",
);

// ─── MQTT publisher ───────────────────────────────────────────────────────────

const publisher = new MqttPublisher(config.mqtt.url);

// ─── Scada-LTS auth ───────────────────────────────────────────────────────────

const auth = new ScadaLTSAuthClient(
  config.scadalts.baseUrl,
  config.scadalts.username,
  config.scadalts.password,
);

try {
  await auth.login();
  log.info("Initial authentication succeeded");
} catch (err: unknown) {
  log.error({ err }, "Initial authentication failed — exiting");
  process.exit(1);
}

// ─── XID validation (warn, don't crash) ──────────────────────────────────────

const configuredXids = config.datapoints.map((dp) => dp.xid);
await auth.validateXids(configuredXids);

// ─── Session keepalive ────────────────────────────────────────────────────────

auth.startKeepalive(config.scadalts.keepaliveIntervalMs);

// ─── Polling loops ────────────────────────────────────────────────────────────

const poller = new DataPointPoller(config.scadalts.baseUrl, auth, publisher);
poller.startAll(config.datapoints);

log.info({ datapoints: config.datapoints.length }, "Collector running");

// ─── Health check server ──────────────────────────────────────────────────────

const healthServer = startHealthServer();

// ─── Graceful shutdown ────────────────────────────────────────────────────────

function shutdown(signal: string): void {
  log.info({ signal }, "Shutting down");
  poller.stopAll();
  auth.stopKeepalive();
  publisher.end();
  healthServer.close();
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
