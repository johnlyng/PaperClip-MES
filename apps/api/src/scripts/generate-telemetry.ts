/**
 * generate-telemetry.ts — Simulated machine telemetry data generator.
 *
 * Publishes realistic MQTT telemetry to EMQX so the OEE pipeline can be
 * validated end-to-end without physical shop-floor hardware.
 *
 * Usage:
 *   # Run continuously (Ctrl-C to stop):
 *   tsx src/scripts/generate-telemetry.ts
 *
 *   # Run for a fixed number of cycles then exit:
 *   tsx src/scripts/generate-telemetry.ts --cycles 100
 *
 *   # Custom MQTT broker and interval:
 *   MQTT_URL=mqtt://emqx:1883 tsx src/scripts/generate-telemetry.ts --interval-ms 500
 *
 * Topic published (canonical MqttTopics.machineTelemetry pattern):
 *   mes/<machineId>/telemetry
 *
 * One message per metric per interval; the metric name is in the payload.
 *
 * Payload (JSON, MqttTelemetryPayload shape):
 *   { machineId, metric, value, ts, tags }
 *
 * Metrics published every interval:
 *   status       : 1.0 running, 0.0 stopped (realistic fault/maintenance cycles)
 *   output_count : pieces/kg produced since last interval
 *   good_count   : good pieces (total - scrap)
 *
 * Machine scenarios:
 *   machine-mock-001 (CNC Lathe)     : 95% availability, rare faults
 *   machine-mock-002 (Milling)       : 80% availability, longer maintenance windows
 *   machine-mock-003 (Robot Gamma)   : 70% availability, currently in fault state
 *   machine-reactor-001 (Reactor)    : 90% availability, batch process
 *   machine-reactor-002 (Mixer)      : 88% availability, continuous process
 *   machine-dryer-001 (Spray Dryer)  : 85% availability, filter backwash downtime
 */

import mqtt from "mqtt";
import type { MqttTelemetryPayload } from "@mes/types";

// ─── Configuration ───────────────────────────────────────────────────────────

const MQTT_URL = process.env["MQTT_URL"] ?? "mqtt://localhost:1883";
const INTERVAL_MS = parseInt(process.env["TELEMETRY_INTERVAL_MS"] ?? "1000", 10);

// Parse CLI args
const args = process.argv.slice(2);
const cyclesArg = args.indexOf("--cycles");
const MAX_CYCLES = cyclesArg !== -1 ? parseInt(args[cyclesArg + 1] ?? "0", 10) : Infinity;
const intervalArg = args.indexOf("--interval-ms");
const intervalMs = intervalArg !== -1 ? parseInt(args[intervalArg + 1] ?? "1000", 10) : INTERVAL_MS;

// ─── Machine definitions ──────────────────────────────────────────────────────

interface MachineScenario {
  id: string;
  name: string;
  /** Fraction of time the machine should be running (0–1) */
  availabilityTarget: number;
  /** Ideal output rate in units/min when running */
  idealRatePerMin: number;
  /** Scrap rate (fraction of output that is scrap) */
  scrapRate: number;
  /** Mean time to failure in cycles (higher = less frequent faults) */
  mttfCycles: number;
  /** Mean time to repair in cycles */
  mttrCycles: number;
  unit: string;
}

const MACHINES: MachineScenario[] = [
  {
    id: "machine-mock-001",
    name: "CNC Lathe Alpha",
    availabilityTarget: 0.95,
    idealRatePerMin: 10,
    scrapRate: 0.02,
    mttfCycles: 300,
    mttrCycles: 15,
    unit: "pcs",
  },
  {
    id: "machine-mock-002",
    name: "Milling Station Beta",
    availabilityTarget: 0.80,
    idealRatePerMin: 8,
    scrapRate: 0.04,
    mttfCycles: 150,
    mttrCycles: 30,
    unit: "pcs",
  },
  {
    id: "machine-mock-003",
    name: "Assembly Robot Gamma",
    availabilityTarget: 0.70,
    idealRatePerMin: 15,
    scrapRate: 0.05,
    mttfCycles: 100,
    mttrCycles: 40,
    unit: "pcs",
  },
  {
    id: "machine-reactor-001",
    name: "Batch Reactor R-101",
    availabilityTarget: 0.90,
    idealRatePerMin: 2,
    scrapRate: 0.08,
    mttfCycles: 200,
    mttrCycles: 20,
    unit: "kg",
  },
  {
    id: "machine-reactor-002",
    name: "Continuous Mixer CM-201",
    availabilityTarget: 0.88,
    idealRatePerMin: 5,
    scrapRate: 0.03,
    mttfCycles: 250,
    mttrCycles: 25,
    unit: "L",
  },
  {
    id: "machine-dryer-001",
    name: "Spray Dryer SD-301",
    availabilityTarget: 0.85,
    idealRatePerMin: 3,
    scrapRate: 0.06,
    mttfCycles: 180,
    mttrCycles: 20,
    unit: "kg",
  },
];

// ─── Machine state ────────────────────────────────────────────────────────────

interface MachineState {
  scenario: MachineScenario;
  isRunning: boolean;
  cyclesUntilChange: number;
  /** Performance degradation factor (0.8–1.0) — simulates speed loss */
  performanceFactor: number;
}

function initState(scenario: MachineScenario): MachineState {
  const isRunning = Math.random() < scenario.availabilityTarget;
  return {
    scenario,
    isRunning,
    cyclesUntilChange: isRunning
      ? Math.round(scenario.mttfCycles * (0.5 + Math.random()))
      : Math.round(scenario.mttrCycles * (0.5 + Math.random())),
    performanceFactor: 0.85 + Math.random() * 0.15,
  };
}

function stepState(state: MachineState): MachineState {
  const updated = { ...state };
  updated.cyclesUntilChange -= 1;

  if (updated.cyclesUntilChange <= 0) {
    updated.isRunning = !updated.isRunning;
    updated.cyclesUntilChange = updated.isRunning
      ? Math.round(state.scenario.mttfCycles * (0.5 + Math.random()))
      : Math.round(state.scenario.mttrCycles * (0.5 + Math.random()));
    // Slight performance variation on restart
    updated.performanceFactor = 0.85 + Math.random() * 0.15;
  }

  return updated;
}

// ─── Publish helpers ──────────────────────────────────────────────────────────

function publish(
  client: mqtt.MqttClient,
  machineId: string,
  metric: string,
  value: number,
  tags?: Record<string, string>
): void {
  const payload: MqttTelemetryPayload = {
    machineId,
    metric,
    value: Math.round(value * 1000) / 1000,
    ts: new Date().toISOString(),
    tags,
  };
  const topic = `mes/${machineId}/telemetry`;
  client.publish(topic, JSON.stringify(payload), { qos: 1 });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const client = mqtt.connect(MQTT_URL, {
    clientId: `mes-telemetry-generator-${process.pid}`,
    clean: true,
    reconnectPeriod: 3_000,
  });

  await new Promise<void>((resolve, reject) => {
    client.on("connect", () => {
      console.log(`[generator] Connected to MQTT broker at ${MQTT_URL}`);
      console.log(`[generator] Publishing telemetry for ${MACHINES.length} machines every ${intervalMs}ms`);
      if (MAX_CYCLES !== Infinity) {
        console.log(`[generator] Will run for ${MAX_CYCLES} cycles then exit`);
      }
      resolve();
    });
    client.on("error", reject);
    setTimeout(() => reject(new Error("MQTT connect timeout")), 10_000);
  });

  const states = new Map<string, MachineState>(
    MACHINES.map((m) => [m.id, initState(m)])
  );

  let cycle = 0;
  const intervalMin = intervalMs / 60_000;

  const timer = setInterval(() => {
    cycle += 1;
    const now = new Date();

    for (const [id, state] of states) {
      const { scenario, isRunning, performanceFactor } = state;

      // status metric: 1.0 = running, 0.0 = stopped
      publish(client, id, "status", isRunning ? 1 : 0, { unit: scenario.unit });

      if (isRunning) {
        // output_count: actual output = ideal_rate * performance_factor * interval
        const rawOutput = scenario.idealRatePerMin * performanceFactor * intervalMin;
        // Add some noise (±10%)
        const noise = 1 + (Math.random() - 0.5) * 0.2;
        const totalOutput = Math.max(0, rawOutput * noise);
        const scrap = totalOutput * scenario.scrapRate * (0.5 + Math.random());
        const goodOutput = Math.max(0, totalOutput - scrap);

        publish(client, id, "output_count", totalOutput, { unit: scenario.unit });
        publish(client, id, "good_count", goodOutput, { unit: scenario.unit });
      } else {
        // Machine stopped — publish zero counts so aggregates stay accurate
        publish(client, id, "output_count", 0, { unit: scenario.unit });
        publish(client, id, "good_count", 0, { unit: scenario.unit });
      }

      // Step state machine
      states.set(id, stepState(state));
    }

    if (cycle % 60 === 0) {
      const running = [...states.values()].filter((s) => s.isRunning).length;
      console.log(`[generator] Cycle ${cycle} | ${now.toISOString()} | ${running}/${MACHINES.length} machines running`);
    }

    if (cycle >= MAX_CYCLES) {
      clearInterval(timer);
      client.end(() => {
        console.log(`[generator] Completed ${cycle} cycles. Exiting.`);
        process.exit(0);
      });
    }
  }, intervalMs);

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log("\n[generator] Shutting down…");
    clearInterval(timer);
    client.end(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    clearInterval(timer);
    client.end(() => process.exit(0));
  });
}

main().catch((err) => {
  console.error("[generator] Fatal error:", err);
  process.exit(1);
});
