/**
 * DataPointPoller — per-XID HTTP polling loop against the Scada-LTS REST API.
 *
 * Scada-LTS endpoint for current value:
 *   GET /api/point_value/getValue/{xid}.json
 *   Cookie: JSESSIONID=...
 *
 * Each configured data point gets its own setInterval at the configured
 * intervalMs. Consecutive fetch errors increment an error counter; after
 * MAX_ERRORS the poller logs a warning but continues (Integration Engineer
 * will add circuit-breaker logic in Phase 2).
 *
 * Phase 1 scaffold: polling loop and error counting are wired; value parsing
 * and schema validation are stubs to be completed by the Integration Engineer.
 */

import type { DataPoint } from "./config.js";
import type { ScadaLTSAuthClient } from "./auth.js";
import type { MqttPublisher } from "./publisher.js";

/** Shape of the Scada-LTS point_value/getValue response. */
interface ScadaPointValue {
  ts: number;      // Unix timestamp in ms
  value: number;
  type: string;    // e.g. "NumericValue"
}

const MAX_ERRORS = 5;

export class DataPointPoller {
  private readonly timers: ReturnType<typeof setInterval>[] = [];
  private readonly errorCounts = new Map<string, number>();

  constructor(
    private readonly baseUrl: string,
    private readonly auth: ScadaLTSAuthClient,
    private readonly publisher: MqttPublisher,
  ) {}

  /** Start one poll loop per data point. */
  startAll(datapoints: DataPoint[]): void {
    for (const dp of datapoints) {
      this.errorCounts.set(dp.xid, 0);
      const timer = setInterval(() => {
        void this.pollOne(dp);
      }, dp.intervalMs);
      this.timers.push(timer);
      console.info(`[poller] Started poll for XID ${dp.xid} every ${dp.intervalMs.toString()} ms`);
    }
  }

  /** Stop all running poll loops. */
  stopAll(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers.length = 0;
    console.info("[poller] All poll loops stopped");
  }

  private async pollOne(dp: DataPoint): Promise<void> {
    try {
      const url = `${this.baseUrl}/api/point_value/getValue/${encodeURIComponent(dp.xid)}.json`;
      const res = await fetch(url, {
        headers: { Cookie: this.auth.getSessionCookie() },
      });

      if (!res.ok) {
        this.recordError(dp.xid, `HTTP ${res.status.toString()}`);
        return;
      }

      const body = (await res.json()) as ScadaPointValue;
      this.errorCounts.set(dp.xid, 0); // reset on success

      this.publisher.publish({
        machineId: dp.machineId,
        metric: dp.metric,
        value: body.value,
        ts: new Date(body.ts).toISOString(),
        tags: { xid: dp.xid, source: "scadalts" },
      });
    } catch (err: unknown) {
      this.recordError(dp.xid, String(err));
    }
  }

  private recordError(xid: string, reason: string): void {
    const count = (this.errorCounts.get(xid) ?? 0) + 1;
    this.errorCounts.set(xid, count);
    const level = count >= MAX_ERRORS ? "error" : "warn";
    console[level](`[poller] XID ${xid} error #${count.toString()}: ${reason}`);
  }
}
