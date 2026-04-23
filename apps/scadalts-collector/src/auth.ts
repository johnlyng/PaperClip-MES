/**
 * ScadaLTSAuthClient — manages session authentication and keepalive for the
 * Scada-LTS REST API.
 *
 * Scada-LTS uses cookie-based session auth:
 *   GET /api/auth/{username}.json?password={password}
 * The response sets a JSESSIONID cookie that must be forwarded on all subsequent
 * API requests. The session expires after inactivity; keepalive re-authenticates
 * on a configurable interval to prevent expiry during long-running collection.
 *
 * Phase 1 scaffold: login and keepalive are wired; full error retry backoff
 * is a Phase 2 task (Integration Engineer).
 */

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
   * Throws if the server returns a non-2xx status.
   */
  async login(): Promise<void> {
    const url = `${this.baseUrl}/api/auth/${encodeURIComponent(this.username)}.json?password=${encodeURIComponent(this.password)}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`ScadaLTS auth failed: HTTP ${res.status.toString()}`);
    }
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      // Extract JSESSIONID from Set-Cookie header value
      const match = /JSESSIONID=[^;]+/.exec(setCookie);
      this.sessionCookie = match ? match[0] : setCookie;
    }
  }

  /** Returns the current session cookie string for use in Authorization or Cookie headers. */
  getSessionCookie(): string {
    return this.sessionCookie;
  }

  /**
   * Start periodic re-authentication to prevent session expiry.
   * Call after the first successful login().
   */
  startKeepalive(intervalMs: number): void {
    if (this.keepaliveTimer !== null) return; // already running
    this.keepaliveTimer = setInterval(() => {
      void this.login().catch((err: unknown) => {
        console.error("[auth] Keepalive re-auth failed:", err);
      });
    }, intervalMs);
  }

  /** Stop the keepalive timer — call during graceful shutdown. */
  stopKeepalive(): void {
    if (this.keepaliveTimer !== null) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }
}
