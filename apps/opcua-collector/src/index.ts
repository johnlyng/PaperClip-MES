/**
 * OPC-UA Collector — reads monitored items from OPC-UA servers and publishes
 * telemetry to EMQX via MQTT.
 *
 * ADR-001 Decision 7:
 * - Monitored-item subscriptions (server pushes on value change)
 * - Connection pooling: OPCUAClient reused per endpoint
 * - Supervised exponential backoff reconnect (1s → 2s → 4s → max 60s)
 * - Security policy gated by OPCUA_SECURITY_POLICY env var
 * - Node IDs are configuration, not code (machine profiles in YAML — GST Phase 2)
 *
 * Phase 1 scaffold: parses env config, logs startup state, and stubs the
 * collector loop. Full OPC-UA subscription wiring is a Phase 2 task.
 */

import pino from "pino";
import mqtt from "mqtt";
import type { MqttTelemetryPayload, MqttTopics as _MqttTopics } from "@mes/types";
import { MqttTopics } from "@mes/types";

const log = pino({ level: process.env.LOG_LEVEL ?? "info" });

const MQTT_URL = process.env.MQTT_URL ?? "mqtt://localhost:1883";
const OPCUA_ENDPOINTS_RAW = process.env.OPCUA_ENDPOINTS ?? "[]";
const OPCUA_SECURITY_POLICY = process.env.OPCUA_SECURITY_POLICY ?? "None";

// Parse OPC-UA endpoint list from env
let opcuaEndpoints: string[] = [];
try {
  opcuaEndpoints = JSON.parse(OPCUA_ENDPOINTS_RAW) as string[];
} catch {
  log.warn("Could not parse OPCUA_ENDPOINTS — defaulting to empty list (dev mode)");
}

log.info({ mqttUrl: MQTT_URL, opcuaEndpoints, securityPolicy: OPCUA_SECURITY_POLICY }, "OPC-UA Collector starting");

// ─── MQTT client ─────────────────────────────────────────────────────────────

const mqttClient = mqtt.connect(MQTT_URL, {
  reconnectPeriod: 5000,
  username: process.env.MQTT_USERNAME,
  password: process.env.MQTT_PASSWORD,
});

mqttClient.on("connect", () => {
  log.info({ mqttUrl: MQTT_URL }, "MQTT connected");
});

mqttClient.on("error", (err) => {
  log.error({ err }, "MQTT error");
});

// ─── Dev mode stub ───────────────────────────────────────────────────────────
// When OPCUA_ENDPOINTS is empty (no SCADA configured yet), publish synthetic
// telemetry every 5 seconds so the API and web dashboard have data to display.

if (opcuaEndpoints.length === 0) {
  log.info("No OPC-UA endpoints configured — running in synthetic telemetry mode (dev)");

  const MACHINE_IDS = ["machine-mock-001", "machine-mock-002"];

  setInterval(() => {
    for (const machineId of MACHINE_IDS) {
      const payload: MqttTelemetryPayload = {
        machineId,
        metric: "spindleSpeed",
        value: 1000 + Math.random() * 500,
        ts: new Date().toISOString(),
        tags: { unit: "rpm", source: "synthetic" },
      };
      const topic = MqttTopics.machineTelemetry(machineId);
      mqttClient.publish(topic, JSON.stringify(payload), { qos: 1 });
      log.debug({ topic, payload }, "Published synthetic telemetry");
    }
  }, 5_000);
} else {
  // Real OPC-UA subscription wiring — Phase 2 implementation task
  log.info({ opcuaEndpoints }, "OPC-UA endpoints configured — Phase 2 subscription wiring required");
  // TODO: GST Phase 2 — instantiate OPCUAClient per endpoint, establish sessions,
  //       subscribe to monitored items from machine profile YAML, publish to MQTT.
}
