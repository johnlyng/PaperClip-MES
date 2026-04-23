/**
 * emqxContainer.ts — Testcontainers helper for EMQX 5 broker.
 *
 * Usage in integration tests:
 *
 *   import { startEmqxContainer, stopEmqxContainer } from "@mes/test-fixtures/containers";
 *
 *   let emqx: StartedEmqxContainer;
 *
 *   beforeAll(async () => { emqx = await startEmqxContainer(); }, 60_000);
 *   afterAll(async () => { await stopEmqxContainer(emqx); });
 *
 *   // Connect via emqx.mqttUrl — e.g. "mqtt://localhost:1883"
 *   // Dashboard at emqx.dashboardUrl (for debugging)
 */

// NOTE: Requires testcontainers package. Container image: emqx/emqx:5.8.6
export interface StartedEmqxContainer {
  /** MQTT broker connection URL — use with the mqtt package */
  mqttUrl: string;
  /** EMQX HTTP API base URL — used for ACL/auth integration tests */
  apiUrl: string;
  host: string;
  mqttPort: number;
  apiPort: number;
  stop(): Promise<void>;
}

const EMQX_IMAGE = "emqx/emqx:5.8.6";

/**
 * Starts an EMQX 5 broker container with anonymous access enabled.
 * For MQTT ACL tests, configure ACL rules via the EMQX HTTP API
 * (emqx.apiUrl/api/v5/authorization/...) after the container starts.
 */
export async function startEmqxContainer(opts?: {
  image?: string;
}): Promise<StartedEmqxContainer> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { GenericContainer, Wait } = await import("testcontainers" as any);

  const image = opts?.image ?? EMQX_IMAGE;

  const started = await new GenericContainer(image)
    .withExposedPorts(1883, 8081, 18083)
    .withEnvironment({
      // Allow anonymous MQTT connections in test environment
      EMQX_ALLOW_ANONYMOUS: "true",
      // Disable persistence for faster startup
      EMQX_LOG__LEVEL: "warning",
    })
    .withWaitStrategy(
      Wait.forHttp("/api/v5/status", 18083).forStatusCode(200)
    )
    .start();

  const host = started.getHost();
  const mqttPort = started.getMappedPort(1883);
  const apiPort = started.getMappedPort(18083);

  return {
    mqttUrl: `mqtt://${host}:${mqttPort}`,
    apiUrl: `http://${host}:${apiPort}`,
    host,
    mqttPort,
    apiPort,
    stop: () => started.stop(),
  };
}

export async function stopEmqxContainer(
  container: StartedEmqxContainer
): Promise<void> {
  await container.stop();
}
