/**
 * Config loader — reads YAML config/datapoints.yml and returns a typed CollectorConfig.
 *
 * Config file path is resolved relative to process.cwd() so it works both in
 * dev (monorepo root) and in the Docker container (/app).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";

export interface DataPoint {
  /** Scada-LTS data point XID (e.g. "DP_MACHINE1_SPINDLE_SPEED") */
  xid: string;
  /** Machine identifier used for MQTT topic routing */
  machineId: string;
  /** Metric name published in the telemetry payload */
  metric: string;
  /** Poll interval in milliseconds */
  intervalMs: number;
}

export interface CollectorConfig {
  scadalts: {
    /** Base URL of the Scada-LTS instance, e.g. http://scadalts:8080 */
    baseUrl: string;
    /** Scada-LTS login username */
    username: string;
    /** Scada-LTS login password (set via SCADALTS_PASSWORD env var at runtime) */
    password: string;
    /** How often to re-authenticate to keep the session alive (ms) */
    keepaliveIntervalMs: number;
  };
  mqtt: {
    /** MQTT broker URL, e.g. mqtt://emqx:1883 */
    url: string;
  };
  datapoints: DataPoint[];
}

export function loadConfig(configPath?: string): CollectorConfig {
  const filePath = resolve(process.cwd(), configPath ?? "config/datapoints.yml");
  const raw = readFileSync(filePath, "utf-8");
  const parsed = parse(raw) as CollectorConfig;

  // Substitute environment variable overrides so secrets stay out of YAML
  parsed.scadalts.baseUrl = process.env["SCADALTS_BASE_URL"] ?? parsed.scadalts.baseUrl;
  parsed.scadalts.password = process.env["SCADALTS_PASSWORD"] ?? parsed.scadalts.password;
  parsed.mqtt.url = process.env["MQTT_URL"] ?? parsed.mqtt.url;

  return parsed;
}
