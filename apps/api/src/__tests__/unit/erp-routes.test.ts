/**
 * ERP route unit tests — security-critical paths (B4 + B5 from Staff Engineer review)
 *
 * Tests run against a minimal Fastify instance (JWT + ERP plugin only) to keep
 * the suite fast and independent of @mes/db, MQTT, or PostgreSQL.
 *
 * Covers:
 *   - 401 when JWT is absent on POST /erp/confirm
 *   - 403 when role=operator on POST /erp/confirm
 *   - 400 when actualQuantity + scrapQuantity > wo.quantity
 *   - 400 when quantities are negative (schema minimum: 0)
 *   - 422 when work order is not completed
 *   - 200 happy path: confirm a completed WO
 *   - GET /erp/health returns connected + latency
 */

import Fastify, { type FastifyInstance } from "fastify";
import jwt from "@fastify/jwt";
import { MockERPAdapter } from "@mes/domain/erp";
import erpRoutes from "../../routes/v1/erp.js";
import type { WorkOrder } from "@mes/types";

// ─── Test fixtures ────────────────────────────────────────────────────────────

const BASE_WO: WorkOrder = {
  id: "wo-test-001",
  workOrderNumber: "WO-TEST-001",
  title: "Test Work Order",
  productId: "PROD-001",
  quantity: 100,
  unit: "EA",
  scheduledStart: new Date("2026-04-01"),
  scheduledEnd: new Date("2026-04-01"),
  status: "completed",
  priority: 1,
  machineId: "machine-001",
  erpReference: "1000001",
  actualEnd: new Date("2026-04-01T10:00:00Z"),
  createdAt: new Date("2026-04-01"),
  updatedAt: new Date("2026-04-01"),
};

// ─── App factory ─────────────────────────────────────────────────────────────

const JWT_SECRET = "test-secret-do-not-use-in-prod";

async function buildTestApp(store: WorkOrder[]): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.register(jwt, { secret: JWT_SECRET });

  const erpAdapter = new MockERPAdapter();
  app.register(erpRoutes, {
    prefix: "/api/v1",
    erpAdapter,
    workOrderStore: store,
  });

  await app.ready();
  return app;
}

function signToken(app: FastifyInstance, role: string, sub = "test-user"): string {
  return (app as FastifyInstance & { jwt: { sign: (payload: object) => string } })
    .jwt.sign({ sub, role });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/v1/erp/confirm/:workOrderId — authorization (BLOCKER 5)", () => {
  let app: FastifyInstance;
  let store: WorkOrder[];

  beforeEach(async () => {
    store = [{ ...BASE_WO }];
    app = await buildTestApp(store);
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns 401 when Authorization header is absent", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/erp/confirm/wo-test-001",
      payload: { actualQuantity: 90, scrapQuantity: 5 },
    });

    expect(res.statusCode).toBe(401);
    const body = res.json<{ statusCode: number }>();
    expect(body.statusCode).toBe(401);
  });

  it("returns 401 when JWT is malformed", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/erp/confirm/wo-test-001",
      headers: { Authorization: "Bearer not-a-valid-jwt" },
      payload: { actualQuantity: 90, scrapQuantity: 5 },
    });

    expect(res.statusCode).toBe(401);
  });

  it("returns 403 when role is 'operator' (insufficient for confirmation)", async () => {
    const token = signToken(app, "operator");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/erp/confirm/wo-test-001",
      headers: { Authorization: `Bearer ${token}` },
      payload: { actualQuantity: 90, scrapQuantity: 5 },
    });

    expect(res.statusCode).toBe(403);
    const body = res.json<{ statusCode: number; message: string }>();
    expect(body.statusCode).toBe(403);
    expect(body.message).toMatch(/operator/);
  });

  it("allows supervisor role", async () => {
    const token = signToken(app, "supervisor");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/erp/confirm/wo-test-001",
      headers: { Authorization: `Bearer ${token}` },
      payload: { actualQuantity: 90, scrapQuantity: 5 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ confirmed: boolean }>().confirmed).toBe(true);
  });

  it("allows engineer role", async () => {
    const token = signToken(app, "engineer");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/erp/confirm/wo-test-001",
      headers: { Authorization: `Bearer ${token}` },
      payload: { actualQuantity: 90, scrapQuantity: 5 },
    });

    expect(res.statusCode).toBe(200);
  });

  it("allows admin role", async () => {
    const token = signToken(app, "admin");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/erp/confirm/wo-test-001",
      headers: { Authorization: `Bearer ${token}` },
      payload: { actualQuantity: 90, scrapQuantity: 5 },
    });

    expect(res.statusCode).toBe(200);
  });
});

describe("POST /api/v1/erp/confirm/:workOrderId — quantity validation (BLOCKER 4)", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildTestApp([{ ...BASE_WO }]);
  });

  afterEach(async () => {
    await app.close();
  });

  function supervisorToken(): string {
    return signToken(app, "supervisor");
  }

  it("returns 400 when actualQuantity + scrapQuantity exceeds work order quantity", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/erp/confirm/wo-test-001",
      headers: { Authorization: `Bearer ${supervisorToken()}` },
      // wo.quantity = 100; 95 + 10 = 105 > 100
      payload: { actualQuantity: 95, scrapQuantity: 10 },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json<{ message: string }>();
    expect(body.message).toMatch(/must not exceed/);
  });

  it("returns 400 when quantities exactly equal work order quantity + 1", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/erp/confirm/wo-test-001",
      headers: { Authorization: `Bearer ${supervisorToken()}` },
      payload: { actualQuantity: 100, scrapQuantity: 1 }, // 101 > 100
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 200 when actualQuantity + scrapQuantity exactly equals wo.quantity", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/erp/confirm/wo-test-001",
      headers: { Authorization: `Bearer ${supervisorToken()}` },
      payload: { actualQuantity: 90, scrapQuantity: 10 }, // 100 == 100
    });

    expect(res.statusCode).toBe(200);
  });

  it("returns 200 when actualQuantity + scrapQuantity is under wo.quantity", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/erp/confirm/wo-test-001",
      headers: { Authorization: `Bearer ${supervisorToken()}` },
      payload: { actualQuantity: 80, scrapQuantity: 5 }, // 85 < 100
    });

    expect(res.statusCode).toBe(200);
  });

  it("returns 400 on negative actualQuantity (schema minimum: 0)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/erp/confirm/wo-test-001",
      headers: { Authorization: `Bearer ${supervisorToken()}` },
      payload: { actualQuantity: -1, scrapQuantity: 5 },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe("POST /api/v1/erp/confirm/:workOrderId — business rules", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildTestApp([{ ...BASE_WO }]);
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns 404 when work order does not exist", async () => {
    const token = signToken(app, "supervisor");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/erp/confirm/wo-does-not-exist",
      headers: { Authorization: `Bearer ${token}` },
      payload: { actualQuantity: 90, scrapQuantity: 5 },
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 422 when work order is not completed", async () => {
    const store: WorkOrder[] = [{ ...BASE_WO, status: "in_progress" }];
    const localApp = await buildTestApp(store);
    const token = signToken(localApp, "supervisor");

    const res = await localApp.inject({
      method: "POST",
      url: "/api/v1/erp/confirm/wo-test-001",
      headers: { Authorization: `Bearer ${token}` },
      payload: { actualQuantity: 90, scrapQuantity: 5 },
    });

    expect(res.statusCode).toBe(422);
    await localApp.close();
  });
});

describe("GET /api/v1/erp/health", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildTestApp([]);
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns connected=true with latency when MockERPAdapter is used", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/erp/health",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ connected: boolean; latency: number }>();
    expect(body.connected).toBe(true);
    expect(typeof body.latency).toBe("number");
  });
});
