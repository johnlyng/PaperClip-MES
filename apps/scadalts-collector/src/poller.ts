/**
 * DataPointPoller — per-XID HTTP polling against the Scada-LTS REST API.
 *
 * Endpoint:
 *   GET /api/point_value/getValue/{xid}   (Scada-LTS ≥ 2.8, no .json suffix)
 *   Cookie: JSESSIONID=...
 *
 * Error-handling contract:
 *   - 401 response → re-auth once; if still 401, log and skip cycle.
 *   - Non-2xx response → log and skip cycle (increment error counter).
 *   - 3 consecutive failures for a data point → publish DISCONNECTED to
 *     mes/{machineId}/status.
 *   - First success after DISCONNECTED state → publish CONNECTED.
 */

import type { DataPoint } from "./config.js";
import type { ScadaLTSAuthClient } from "./auth.js";
import type { MqttPublisher } from "./publisher.js";
import { createLogger } from "./logger.js";

const log = createLogger("poller");

/** Shape of the Scada-LTS point_value/getValue response. */
interface ScadaPointValue {
  ts: number;     // Unix timestamp in ms
  value: number;
  type: string;   // e.g. "NumericValue"
}

/** Number of consecutive failures before publishing DISCONNECTED. */
const DISCONNECT_THRESHOLD = 3;

export class DataPointPoller {
  private readonly timers: ReturnType<typeof setInterval>[] = [];
  private readonly consecutiveErrors = new Map<string, number>();
  /** XIDs that have already emitted DISCONNECTED and not yet recovered. */
  private readonly disconnected = new Set<string>();

  constructor(
    private readonly baseUrl: string,
    private readonly auth: ScadaLTSAuthClient,
    private readonly publisher: MqttPublisher,
  ) {}

  /** Start one poll loop per data point. */
  startAll(datapoints: DataPoint[]): void {
    for (const dp of datapoints) {
      this.consecutiveErrors.set(dp.xid, 0);
      const timer = setInterval(() => {
        void this.pollOne(dp);
      }, dp.intervalMs);
      this.timers.push(timer);
      log.info({ xid: dp.xid, intervalMs: dp.intervalMs }, "Poll loop started");
    }
  }

  /** Stop all running poll loops. */
  stopAll(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers.length = 0;
    log.info("All poll loops stopped");
  }

  private async pollOne(dp: DataPoint): Promise<void> {
    const url = `${this.baseUrl}/api/point_value/getValue/${encodeURIComponent(dp.xid)}`;
    try {
      let res = await fetch(url, {
        headers: { Cookie: this.auth.getSessionCookie() },
      });

      // 401 — try re-auth once, then retry the request
      if (res.status === 401) {
        log.warn({ xid: dp.xid }, "Got 401 — attempting re-auth");
        const ok = await this.auth.reAuth();
        if (!ok) {
          this.recordFailure(dp, "401 and re-auth failed");
          return;
        }
        res = await fetch(url, {
          headers: { Cookie: this.auth.getSessionCookie() },
        });
        if (res.status === 401) {
          this.recordFailure(dp, "401 persists after re-auth");
          return;
        }
      }

      if (!res.ok) {
        this.recordFailure(dp, `HTTP ${res.status.toString()} ${res.statusText}`);
        return;
      }

      const body = (await res.json()) as ScadaPointValue;
      this.recordSuccess(dp, body);
    } catch (err: unknown) {
      this.recordFailure(dp, String(err));
    }
  }

  private recordSuccess(dp: DataPoint, body: ScadaPointValue): void {
    const wasDisconnected = this.disconnected.has(dp.xid);
    this.consecutiveErrors.set(dp.xid, 0);
    this.disconnected.delete(dp.xid);

    if (wasDisconnected) {
      this.publisher.publishStatus(dp.machineId, "CONNECTED");
      log.info({ xid: dp.xid, machineId: dp.machineId }, "Recovered — published CONNECTED");
    }

    this.publisher.publish({
      machineId: dp.machineId,
      metric: dp.metric,
      value: body.value,
      ts: new Date(body.ts).toISOString(),
      source: "scadalts",
      xid: dp.xid,
    });

    log.debug({ xid: dp.xid, value: body.value }, "Poll OK");
  }

  private recordFailure(dp: DataPoint, reason: string): void {
    const count = (this.consecutiveErrors.get(dp.xid) ?? 0) + 1;
    this.consecutiveErrors.set(dp.xid, count);

    log.warn({ xid: dp.xid, count, reason }, "Poll failure");

    if (count === DISCONNECT_THRESHOLD && !this.disconnected.has(dp.xid)) {
      this.disconnected.add(dp.xid);
      this.publisher.publishStatus(dp.machineId, "DISCONNECTED");
      log.error(
        { xid: dp.xid, machineId: dp.machineId, count },
        "Threshold reached — published DISCONNECTED",
      );
    }
  }
}
