/**
 * pgContainer.ts — Testcontainers helper for PostgreSQL 16 + TimescaleDB.
 *
 * Usage in integration tests:
 *
 *   import { startPgContainer, stopPgContainer } from "@mes/test-fixtures/containers";
 *
 *   let container: StartedPgContainer;
 *
 *   beforeAll(async () => { container = await startPgContainer(); }, 60_000);
 *   afterAll(async () => { await stopPgContainer(container); });
 *
 *   // Access connection string via container.connectionString
 */

// NOTE: Requires testcontainers package. Add to devDependencies:
//   "testcontainers": "^10.x"
// Container image: timescale/timescaledb:latest-pg16

export interface StartedPgContainer {
  connectionString: string;
  host: string;
  port: number;
  /** Stops the container and cleans up resources */
  stop(): Promise<void>;
}

/** Default TimescaleDB image used across all integration test suites */
const TIMESCALEDB_IMAGE = "timescale/timescaledb:latest-pg16";
const DEFAULT_DB = "mes_test";
const DEFAULT_USER = "mes";
const DEFAULT_PASSWORD = "mes_test_pw";

/**
 * Starts a TimescaleDB container and returns a handle with the connection string.
 * The container is isolated per test suite — never share state between suites.
 *
 * @param opts.image - Override the Docker image (default: timescale/timescaledb:latest-pg16)
 * @param opts.database - Database name (default: mes_test)
 */
export async function startPgContainer(opts?: {
  image?: string;
  database?: string;
}): Promise<StartedPgContainer> {
  // Dynamic import keeps testcontainers out of non-integration test builds
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { GenericContainer, Wait } = await import("testcontainers" as any);

  const image = opts?.image ?? TIMESCALEDB_IMAGE;
  const database = opts?.database ?? DEFAULT_DB;

  const started = await new GenericContainer(image)
    .withExposedPorts(5432)
    .withEnvironment({
      POSTGRES_DB: database,
      POSTGRES_USER: DEFAULT_USER,
      POSTGRES_PASSWORD: DEFAULT_PASSWORD,
    })
    .withWaitStrategy(
      Wait.forLogMessage("database system is ready to accept connections")
    )
    .start();

  const host = started.getHost();
  const port = started.getMappedPort(5432);
  const connectionString = `postgresql://${DEFAULT_USER}:${DEFAULT_PASSWORD}@${host}:${port}/${database}`;

  return {
    connectionString,
    host,
    port,
    stop: () => started.stop(),
  };
}

/**
 * Stops a running container. Alias for container.stop() for symmetric API.
 */
export async function stopPgContainer(
  container: StartedPgContainer
): Promise<void> {
  await container.stop();
}
