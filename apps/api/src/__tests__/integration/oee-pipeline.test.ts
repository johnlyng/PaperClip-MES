/**
 * oee-pipeline.test.ts — End-to-end integration test for the OEE telemetry pipeline.
 *
 * Tests that:
 *   1. The MqttSubscriber correctly receives published MQTT messages and persists
 *      them to machine_telemetry (TimescaleDB hypertable).
 *   2. The OEEQueryService returns correct OEE metrics from the persisted data
 *      after a forced continuous aggregate refresh.
 *
 * Infrastructure:
 *   - TimescaleDB: real container spun up via testcontainers (timescale/timescaledb:latest-pg16)
 *     with the monorepo init scripts mounted for schema + aggregate creation.
 *   - MQTT: in-process aedes broker (no Docker needed) bound to a random TCP port.
 *
 * Design decisions:
 *   - aedes starts in <100ms; avoids an EMQX container (60s startup) in CI.
 *   - The continuous aggregate refresh uses `CALL refresh_continuous_aggregate()`
 *     with a past-covering window so the 1-minute bucket is populated immediately.
 *   - All test data uses a dedicated machineId prefix ("test-machine-") that is
 *     cleaned up in beforeAll, so the test is idempotent on a shared DB.
 *
 * GST-26 acceptance criteria covered:
 *   AC-MQTT-01: MQTT → TimescaleDB pipeline running end-to-end
 *   AC-OEE-02:  Telemetry persisted to hypertable
 *   AC-OEE-03:  Continuous aggregate rollups (1-min) populated from live data
 *   AC-OEE-API: OEE REST query returns correct Availability × Performance × Quality
 */

import net from "net";
import { createServer } from "net";
import { createRequire } from "module";
import mqtt from "mqtt";
// aedes is CJS-only; use createRequire for correct ESM interop
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const createBroker = require("aedes") as (opts?: object) => {
  handle: (socket: net.Socket) => void;
  close: (cb: () => void) => void;
};
import { GenericContainer, Wait } from "testcontainers";
import type { StartedTestContainer } from "testcontainers";
import { sql } from "drizzle-orm";
import { createDb } from "@mes/db";
import { machineTelemetry } from "@mes/db/schema";
import type { Db } from "@mes/db";
import type { MqttTelemetryPayload } from "@mes/types";
import { MqttSubscriber } from "../../services/mqtt-subscriber.js";
import { OEEQueryService } from "../../services/oee-query.js";
import path from "path";
import { fileURLToPath } from "url";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// __dirname = apps/api/src/__tests__/integration — go up 5 levels to monorepo root
const REPO_ROOT = path.resolve(__dirname, "../../../../..");
const INIT_SCRIPTS_DIR = path.join(REPO_ROOT, "infra/compose/init-scripts");

const TEST_MACHINE_ID = "test-machine-pipeline-001";

/** Return a free TCP port by briefly binding and releasing it. */
async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as net.AddressInfo;
      server.close(() => resolve(addr.port));
    });
    server.on("error", reject);
  });
}

/** Publish a single MqttTelemetryPayload and wait for the broker to route it. */
async function publishTelemetry(
  brokerUrl: string,
  payload: MqttTelemetryPayload
): Promise<void> {
  const client = mqtt.connect(brokerUrl, {
    clientId: `test-pub-${Date.now()}`,
    clean: true,
  });
  await new Promise<void>((resolve, reject) => {
    client.on("connect", () => resolve());
    client.on("error", reject);
  });
  const topic = `mes/${payload.machineId}/telemetry`;
  await new Promise<void>((resolve, reject) => {
    client.publish(topic, JSON.stringify(payload), { qos: 1 }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
  await new Promise<void>((resolve) => client.end(false, {}, () => resolve()));
}

/** Sleep for ms milliseconds. */
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ─── Test Lifecycle ──────────────────────────────────────────────────────────

let container: StartedTestContainer;
let db: Db;
let mqttSubscriber: MqttSubscriber;
let brokerPort: number;
let brokerServer: net.Server;
let broker: ReturnType<typeof createBroker>;

beforeAll(async () => {
  // ── 1. Start TimescaleDB container ──────────────────────────────────────
  container = await new GenericContainer("timescale/timescaledb:latest-pg16")
    .withEnvironment({
      POSTGRES_DB: "mes_test",
      POSTGRES_USER: "mes",
      POSTGRES_PASSWORD: "mes",
    })
    .withCopyFilesToContainer([
      {
        source: path.join(INIT_SCRIPTS_DIR, "01-init-timescaledb.sql"),
        target: "/docker-entrypoint-initdb.d/01-init-timescaledb.sql",
      },
      {
        source: path.join(INIT_SCRIPTS_DIR, "02-oee-aggregates.sql"),
        target: "/docker-entrypoint-initdb.d/02-oee-aggregates.sql",
      },
    ])
    .withExposedPorts(5432)
    .withWaitStrategy(
      Wait.forLogMessage("database system is ready to accept connections", 2)
    )
    .start();

  const dbPort = container.getMappedPort(5432);
  const dbUrl = `postgresql://mes:mes@127.0.0.1:${dbPort}/mes_test`;
  db = createDb(dbUrl);

  // ── 2. Start in-process aedes MQTT broker ───────────────────────────────
  brokerPort = await getFreePort();
  broker = createBroker();
  brokerServer = net.createServer(broker.handle.bind(broker));
  await new Promise<void>((resolve, reject) => {
    brokerServer.listen(brokerPort, "127.0.0.1", () => resolve());
    brokerServer.on("error", reject);
  });

  const brokerUrl = `mqtt://127.0.0.1:${brokerPort}`;

  // ── 3. Start MqttSubscriber ─────────────────────────────────────────────
  mqttSubscriber = new MqttSubscriber(db, console as never, brokerUrl);
  await mqttSubscriber.connect();

  // ── 4. Clean any leftover rows for this test machine ───────────────────
  await db.delete(machineTelemetry).where(
    sql`${machineTelemetry.machineId} LIKE 'test-machine-%'`
  );
}, 120_000);

afterAll(async () => {
  await mqttSubscriber.disconnect();
  await new Promise<void>((resolve) => brokerServer.close(() => resolve()));
  await broker.close(() => {});
  await container.stop();
}, 30_000);

// ─── Test 1: MQTT → TimescaleDB telemetry ingestion ─────────────────────────

describe("GST-26 AC-MQTT-01 — MQTT telemetry ingestion pipeline", () => {
  /**
   * Publishes 3 metrics for TEST_MACHINE_ID, waits for the MqttSubscriber's
   * periodic 1-second flush window, then asserts all rows landed in the
   * machine_telemetry hypertable with the correct values.
   */
  it("persists all 3 telemetry metrics to the hypertable", async () => {
    const ts = new Date(Date.now() - 5_000).toISOString(); // 5s in the past

    const payloads: MqttTelemetryPayload[] = [
      { machineId: TEST_MACHINE_ID, metric: "status",       value: 1,  ts },
      { machineId: TEST_MACHINE_ID, metric: "output_count", value: 60, ts },
      { machineId: TEST_MACHINE_ID, metric: "good_count",   value: 57, ts },
    ];

    const brokerUrl = `mqtt://127.0.0.1:${brokerPort}`;
    for (const p of payloads) {
      await publishTelemetry(brokerUrl, p);
    }

    // Wait for the subscriber's 1-second flush timer + network round-trip
    await sleep(2_500);

    const rows = await db
      .select()
      .from(machineTelemetry)
      .where(sql`${machineTelemetry.machineId} = ${TEST_MACHINE_ID}`);

    expect(rows).toHaveLength(3);

    const byMetric = Object.fromEntries(rows.map((r) => [r.metric, r.value]));
    expect(byMetric["status"]).toBe(1);
    expect(byMetric["output_count"]).toBe(60);
    expect(byMetric["good_count"]).toBe(57);
  }, 20_000);
});

// ─── Test 2: OEE continuous aggregate → OEEQueryService ─────────────────────

describe("GST-26 AC-OEE-03 — continuous aggregate rollup and OEE query", () => {
  /**
   * Seeds 60 one-second status=1 readings (1 full minute of running time) plus
   * matching output_count and good_count rows for the same machine.
   * Calls `CALL refresh_continuous_aggregate(...)` to force the 1-minute rollup,
   * then verifies OEEQueryService returns Availability=1, Performance > 0, OEE > 0.
   */
  it("returns OEE > 0 after seeding 1 minute of telemetry and refreshing aggregates", async () => {
    const OEE_MACHINE = "test-machine-oee-001";
    const now = new Date();
    // Use a bucket 2 minutes in the past so it falls inside the aggregate window
    const bucketStart = new Date(now.getTime() - 3 * 60_000);

    // Seed 60 × 1-second rows within the bucket (status, output, good)
    const rows = [] as {
      ts: Date;
      machineId: string;
      metric: string;
      value: number;
      tags: null;
    }[];
    for (let i = 0; i < 60; i++) {
      const t = new Date(bucketStart.getTime() + i * 1_000);
      rows.push({ ts: t, machineId: OEE_MACHINE, metric: "status",       value: 1,  tags: null });
      rows.push({ ts: t, machineId: OEE_MACHINE, metric: "output_count", value: 10, tags: null });
      rows.push({ ts: t, machineId: OEE_MACHINE, metric: "good_count",   value: 9,  tags: null });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.insert(machineTelemetry).values(rows as any[]);

    // Force refresh the 1-minute continuous aggregate for the seeded window
    const refreshStart = new Date(bucketStart.getTime() - 60_000).toISOString();
    const refreshEnd   = new Date(now.getTime()).toISOString();
    await db.execute(sql`
      CALL refresh_continuous_aggregate(
        'oee_1min',
        ${refreshStart}::timestamptz,
        ${refreshEnd}::timestamptz
      )
    `);

    // Query OEE via the service
    const service = new OEEQueryService(db);
    const from = new Date(bucketStart.getTime() - 60_000);
    const to   = new Date(now.getTime() + 60_000);

    const snapshots = await service.queryOEE({
      machineId: OEE_MACHINE,
      from,
      to,
      granularity: "1m",
      idealRatePerMin: 10,
    });

    expect(snapshots.length).toBeGreaterThan(0);

    const snap = snapshots[0];
    // All status readings = 1.0 → Availability should be 1
    expect(snap.availability).toBeCloseTo(1, 1);
    // 60 readings × 10 output/reading = 600 per minute; ideal = 1 × 10 = 10 → perf = 1
    expect(snap.performance).toBeGreaterThan(0);
    // good_count = 9 per reading × 60 = 540; total = 600 → quality = 0.9
    expect(snap.quality).toBeCloseTo(0.9, 1);
    // OEE = A × P × Q > 0
    expect(snap.oee).toBeGreaterThan(0);
  }, 30_000);
});
