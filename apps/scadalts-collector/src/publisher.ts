/**
 * MqttPublisher — publishes telemetry and status events to EMQX.
 *
 * Topics:
 *   mes/{machineId}/telemetry  — per-reading telemetry payload (QoS 1)
 *   mes/{machineId}/status     — CONNECTED / DISCONNECTED events (QoS 1, retain)
 *
 * Reconnect is handled by mqtt.js (reconnectPeriod: 5 000 ms).
 */

import mqtt, { type MqttClient } from "mqtt";
import { createLogger } from "./logger.js";

const log = createLogger("mqtt");

/** Telemetry payload shape — matches AGENTS.md contract. */
export interface TelemetryPayload {
  machineId: string;
  metric: string;
  value: number;
  ts: string;       // ISO 8601
  source: "scadalts";
  xid: string;
}

/** Machine connection state. */
export type MachineStatus = "CONNECTED" | "DISCONNECTED";

export class MqttPublisher {
  private readonly client: MqttClient;

  constructor(brokerUrl: string) {
    this.client = mqtt.connect(brokerUrl, {
      reconnectPeriod: 5_000,
    });

    this.client.on("connect", () => {
      log.info({ brokerUrl }, "Connected to broker");
    });

    this.client.on("error", (err) => {
      log.error({ err }, "Broker error");
    });

    this.client.on("reconnect", () => {
      log.warn("Reconnecting to broker");
    });

    this.client.on("offline", () => {
      log.warn("Broker connection offline");
    });
  }

  /**
   * Publish a telemetry reading to `mes/{machineId}/telemetry`.
   * Fire-and-forget at QoS 1; mqtt.js queues messages when disconnected.
   */
  publish(payload: TelemetryPayload): void {
    const topic = `mes/${payload.machineId}/telemetry`;
    const body = JSON.stringify(payload);
    this.client.publish(topic, body, { qos: 1 }, (err) => {
      if (err) log.error({ err, topic }, "Publish error");
    });
  }

  /**
   * Publish a machine status event to `mes/{machineId}/status`.
   * Retained at QoS 1 so new subscribers see the last known state.
   */
  publishStatus(machineId: string, status: MachineStatus): void {
    const topic = `mes/${machineId}/status`;
    const body = JSON.stringify({ machineId, status, ts: new Date().toISOString() });
    this.client.publish(topic, body, { qos: 1, retain: true }, (err) => {
      if (err) log.error({ err, topic, status }, "Status publish error");
      else log.info({ machineId, status }, "Published machine status");
    });
  }

  /** Gracefully close the MQTT connection. */
  end(): void {
    this.client.end();
    log.info("MQTT client closed");
  }
}
