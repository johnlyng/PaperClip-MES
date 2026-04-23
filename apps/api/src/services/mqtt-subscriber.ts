/**
 * mqtt-subscriber.ts — MQTT telemetry ingestion service.
 *
 * Subscribes to EMQX broker on `mes/telemetry/#` and writes every
 * MqttTelemetryPayload message directly into the machine_telemetry
 * TimescaleDB hypertable via Drizzle.
 *
 * Topic convention (from SCADA-LTS collector and machine agents):
 *   mes/telemetry/<machineId>/<metric>
 *
 * Payload shape (JSON):
 *   { machineId, metric, value, ts, tags? }
 *
 * Usage:
 *   const sub = new MqttSubscriber(db, logger);
 *   await sub.connect();
 *   // sub.disconnect() on shutdown
 */

import mqtt from "mqtt";
import type { MqttClient } from "mqtt";
import type { MqttTelemetryPayload } from "@mes/types";
import { machineTelemetry } from "@mes/db/schema";
import type { Db } from "@mes/db";

/** Minimal logger interface compatible with both Pino and Fastify's BaseLogger */
interface ServiceLogger {
  info(obj: object | string, msg?: string): void;
  warn(obj: object | string, msg?: string): void;
  error(obj: object | string, msg?: string): void;
  debug(obj: object | string, msg?: string): void;
}

const TELEMETRY_TOPIC = "mes/telemetry/#";

/** Number of messages to batch before flushing to DB */
const BATCH_SIZE = 50;

/** Maximum ms to wait before flushing an incomplete batch */
const FLUSH_INTERVAL_MS = 1_000;

/** Row shape for the machine_telemetry hypertable insert */
interface TelemetryInsertRow {
  ts: Date;
  machineId: string;
  metric: string;
  value: number | null;
  tags: Record<string, string> | null;
}

export class MqttSubscriber {
  private client: MqttClient | null = null;
  private batch: TelemetryInsertRow[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly db: Db,
    private readonly logger: ServiceLogger,
    private readonly mqttUrl: string = process.env["MQTT_URL"] ?? "mqtt://localhost:1883"
  ) {}

  async connect(): Promise<void> {
    this.client = mqtt.connect(this.mqttUrl, {
      clientId: `mes-api-telemetry-${process.pid}`,
      clean: true,
      reconnectPeriod: 5_000,
      connectTimeout: 10_000,
    });

    this.client.on("connect", () => {
      this.logger.info({ mqttUrl: this.mqttUrl }, "MQTT connected");
      this.client!.subscribe(TELEMETRY_TOPIC, { qos: 1 }, (err) => {
        if (err) {
          this.logger.error({ err }, "Failed to subscribe to telemetry topic");
        } else {
          this.logger.info({ topic: TELEMETRY_TOPIC }, "Subscribed to telemetry topic");
        }
      });
    });

    this.client.on("message", (_topic, payloadBuf) => {
      this.handleMessage(payloadBuf.toString());
    });

    this.client.on("error", (err) => {
      this.logger.error({ err }, "MQTT client error");
    });

    this.client.on("reconnect", () => {
      this.logger.warn("MQTT reconnecting…");
    });

    // Periodic flush in case we never fill a full batch
    this.flushTimer = setInterval(() => {
      if (this.batch.length > 0) {
        this.flush().catch((err) =>
          this.logger.error({ err }, "Periodic MQTT batch flush failed")
        );
      }
    }, FLUSH_INTERVAL_MS);
  }

  private handleMessage(raw: string): void {
    let payload: MqttTelemetryPayload;
    try {
      payload = JSON.parse(raw) as MqttTelemetryPayload;
    } catch {
      this.logger.warn({ raw: raw.slice(0, 200) }, "Received non-JSON MQTT message, skipping");
      return;
    }

    if (!payload.machineId || !payload.metric || payload.value === undefined) {
      this.logger.warn({ payload }, "Malformed telemetry payload, skipping");
      return;
    }

    this.batch.push({
      ts: payload.ts ? new Date(payload.ts) : new Date(),
      machineId: payload.machineId,
      metric: payload.metric,
      value: typeof payload.value === "number" ? payload.value : Number(payload.value),
      tags: payload.tags ?? null,
    });

    if (this.batch.length >= BATCH_SIZE) {
      this.flush().catch((err) =>
        this.logger.error({ err }, "MQTT batch flush failed")
      );
    }
  }

  private async flush(): Promise<void> {
    if (this.batch.length === 0) return;

    const rows = this.batch.splice(0, this.batch.length);
    try {
      // Cast to any to bridge the dist-compiled schema types with the runtime insert
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await this.db.insert(machineTelemetry).values(rows as any);
      this.logger.debug({ count: rows.length }, "Flushed telemetry batch to DB");
    } catch (err) {
      this.logger.error({ err, count: rows.length }, "Failed to insert telemetry batch");
      // Re-queue failed rows at the front so we don't lose data
      this.batch.unshift(...rows);
    }
  }

  async disconnect(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    // Flush remaining batch
    if (this.batch.length > 0) {
      await this.flush().catch((err) =>
        this.logger.error({ err }, "Final MQTT flush on disconnect failed")
      );
    }
    await new Promise<void>((resolve) => {
      if (this.client) {
        this.client.end(false, {}, () => resolve());
      } else {
        resolve();
      }
    });
    this.logger.info("MQTT subscriber disconnected");
  }
}
