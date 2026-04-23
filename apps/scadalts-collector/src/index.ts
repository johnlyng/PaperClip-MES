/**
 * Scada-LTS Collector — entry point.
 *
 * ADR-001 Decision 7 (amended): Scada-LTS replaces the OPC-UA collector
 * as the SCADA integration path. This service polls the Scada-LTS REST API
 * and publishes machine telemetry to EMQX via MQTT.
 *
 * Data flow:
 *   Scada-LTS REST API → DataPointPoller → MqttPublisher → EMQX → TimescaleDB
 *
 * Configuration:
 *   config/datapoints.yml — machine/datapoint mapping (volume-mounted in Docker)
 *   SCADALTS_BASE_URL, SCADALTS_PASSWORD, MQTT_URL — env var overrides (see config.ts)
 */

import { loadConfig } from "./config.js";
import { ScadaLTSAuthClient } from "./auth.js";
import { DataPointPoller } from "./poller.js";
import { MqttPublisher } from "./publisher.js";

const config = loadConfig();

// Publish telemetry to EMQX
const publisher = new MqttPublisher(config.mqtt.url);

// Authenticate with Scada-LTS
const auth = new ScadaLTSAuthClient(
  config.scadalts.baseUrl,
  config.scadalts.username,
  config.scadalts.password,
);

try {
  await auth.login();
  console.info("[startup] Scada-LTS authenticated");
} catch (err) {
  console.error("[startup] Initial login failed — will retry on first poll:", err);
}

// Start session keepalive
auth.startKeepalive(config.scadalts.keepaliveIntervalMs);

// Start per-XID poll loops
const poller = new DataPointPoller(config.scadalts.baseUrl, auth, publisher);
poller.startAll(config.datapoints);

console.info(
  `[startup] Collector running — ${config.datapoints.length.toString()} datapoints configured`
);

// ─── Graceful shutdown ────────────────────────────────────────────────────────

function shutdown(signal: string): void {
  console.info(`[shutdown] Received ${signal} — stopping`);
  poller.stopAll();
  auth.stopKeepalive();
  publisher.end();
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
