/**
 * MqttPublisher — thin wrapper around mqtt.js for publishing telemetry payloads
 * to the EMQX broker.
 *
 * Topic convention (matches @mes/types MqttTopics):
 *   mes/{machineId}/telemetry
 *
 * Reconnect is handled by mqtt.js (reconnectPeriod: 5000 ms).
 */

import mqtt, { type MqttClient } from "mqtt";

export interface TelemetryPayload {
  machineId: string;
  metric: string;
  value: number;
  ts: string; // ISO 8601
  tags?: Record<string, string>;
}

export class MqttPublisher {
  private readonly client: MqttClient;

  constructor(brokerUrl: string) {
    this.client = mqtt.connect(brokerUrl, {
      reconnectPeriod: 5_000,
    });

    this.client.on("connect", () => {
      console.info("[mqtt] Connected to broker:", brokerUrl);
    });

    this.client.on("error", (err) => {
      console.error("[mqtt] Error:", err);
    });

    this.client.on("reconnect", () => {
      console.warn("[mqtt] Reconnecting…");
    });
  }

  /**
   * Publish a telemetry payload to `mes/{machineId}/telemetry`.
   * The publish is fire-and-forget at QoS 1; MQTT client queues if disconnected.
   */
  publish(payload: TelemetryPayload): void {
    const topic = `mes/${payload.machineId}/telemetry`;
    this.client.publish(topic, JSON.stringify(payload), { qos: 1 }, (err) => {
      if (err) console.error("[mqtt] Publish error on", topic, err);
    });
  }

  /** Gracefully close the MQTT connection. */
  end(): void {
    this.client.end();
  }
}
