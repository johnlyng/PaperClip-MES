/**
 * ScadaLTSAuthClient — session authentication and keepalive for the
 * Scada-LTS REST API.
 *
 * Auth flow:
 *   POST /api/auth/{username}/{password}   (Scada-LTS ≥ 2.8)
 *   → JSESSIONID cookie stored and forwarded on all subsequent requests.
 *
 * Keepalive:
 *   GET /api/datapoint/getAll?limit=1  (every keepaliveIntervalMs)
 *   Pings the session to prevent expiry without triggering a full re-login.
 *   On 401 keepalive response, falls back to full re-login.
 *
 * Error contract:
 *   login()     — throws on non-2xx; caller decides whether to exit or retry.
 *   reAuth()    — silent re-login used by the poller on 401 poll responses.
 */

import { createLogger } from "./logger.js";

const log = createLogger("auth");

export class ScadaLTSAuthClient {
  private sessionCookie = "";
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly username: string,
    private readonly password: string,
  ) {}

  /**
   * Authenticate against Scada-LTS and store the returned session cookie.
   * Throws if the server returns a non-2xx status — caller should exit(1) on
   * startup failure per the error-handling contract.
   */
  async login(): Promise<void> {
    const url = `${this.baseUrl}/api/auth/${encodeURIComponent(this.username)}/${encodeURIComponent(this.password)}`;
    const res = await fetch(url, { method: "POST" });
    if (!res.ok) {
      throw new Error(`ScadaLTS auth failed: HTTP ${res.status.toString()} ${res.statusText}`);
    }
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      const match = /JSESSIONID=[^;]+/.exec(setCookie);
      this.sessionCookie = match ? match[0] : setCookie;
    }
    log.info("Authenticated");
  }

  /**
   * Re-authenticate silently. Used by the poller when it receives a 401
   * on a poll request. Does not throw — logs the error and returns false on
   * failure so the caller can skip the current poll cycle.
   */
  async reAuth(): Promise<boolean> {
    try {
      await this.login();
      log.info("Re-authenticated after 401");
      return true;
    } catch (err: unknown) {
      log.error({ err }, "Re-auth failed");
      return false;
    }
  }

  /** Returns the current session cookie string for use in Cookie headers. */
  getSessionCookie(): string {
    return this.sessionCookie;
  }

  /**
   * Start periodic session keepalive.
   * Sends a lightweight GET /api/datapoint/getAll?limit=1 ping on each tick.
   * Falls back to full re-login if the ping returns 401.
   */
  startKeepalive(intervalMs: number): void {
    if (this.keepaliveTimer !== null) return;
    this.keepaliveTimer = setInterval(() => {
      void this.ping();
    }, intervalMs);
    log.info({ intervalMs }, "Keepalive started");
  }

  /** Stop the keepalive timer — call during graceful shutdown. */
  stopKeepalive(): void {
    if (this.keepaliveTimer !== null) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
      log.info("Keepalive stopped");
    }
  }

  /**
   * Validate that a set of XIDs exist in Scada-LTS.
   * Returns the set of XIDs that are missing (warns — does not throw).
   */
  async validateXids(xids: string[]): Promise<Set<string>> {
    const missing = new Set<string>();
    try {
      const url = `${this.baseUrl}/api/datapoint/getAll`;
      const res = await fetch(url, {
        headers: { Cookie: this.sessionCookie },
      });
      if (!res.ok) {
        log.warn({ status: res.status }, "XID validation: getAll request failed — skipping validation");
        return missing;
      }
      const data = (await res.json()) as Array<{ xid: string }>;
      const knownXids = new Set(data.map((dp) => dp.xid));
      for (const xid of xids) {
        if (!knownXids.has(xid)) {
          missing.add(xid);
          log.warn({ xid }, "Configured XID not found in Scada-LTS — poll will likely fail");
        }
      }
    } catch (err: unknown) {
      log.warn({ err }, "XID validation: network error — skipping validation");
    }
    return missing;
  }

  private async ping(): Promise<void> {
    try {
      const url = `${this.baseUrl}/api/datapoint/getAll?limit=1`;
      const res = await fetch(url, {
        headers: { Cookie: this.sessionCookie },
      });
      if (res.status === 401) {
        log.warn("Keepalive 401 — triggering full re-auth");
        await this.login();
      } else if (!res.ok) {
        log.warn({ status: res.status }, "Keepalive ping non-2xx (ignoring)");
      } else {
        log.debug("Keepalive ping OK");
      }
    } catch (err: unknown) {
      log.warn({ err }, "Keepalive ping error — will retry next cycle");
    }
  }
}
