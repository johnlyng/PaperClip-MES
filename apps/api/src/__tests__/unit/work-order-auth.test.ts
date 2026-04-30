/**
 * Work-order route auth unit tests — GST-52 Phase 2
 *
 * Tests run against a minimal Fastify instance (JWT + work-order plugin only).
 * No DB, MQTT, or external services required — uses the in-memory store.
 *
 * Covers 10 cases per plan Section 9:
 *   1.  GET /work-orders — no JWT → 401
 *   2.  GET /work-orders — valid JWT (operator) → 200
 *   3.  GET /work-orders — valid JWT (supervisor) → 200
 *   4.  POST /work-orders — no JWT → 401
 *   5.  POST /work-orders — operator JWT → 403
 *   6.  POST /work-orders — supervisor JWT → 201
 *   7.  POST /work-orders — admin JWT → 201
 *   8.  PATCH /:id/transition — no JWT → 401
 *   9.  PATCH /:id/transition — operator JWT → 200 (or 404 if WO absent)
 *   10. GET /work-orders/:id — no JWT → 401
 */

import Fastify, { type FastifyInstance } from "fastify";
import jwt from "@fastify/jwt";
import workOrderRoutes from "../../routes/v1/work-orders.js";

const JWT_SECRET = "test-secret-for-work-order-auth";

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.register(jwt, { secret: JWT_SECRET });
  app.register(workOrderRoutes, { prefix: "/api/v1" });
  await app.ready();
  return app;
}

type JwtRole = "operator" | "supervisor" | "admin" | "engineer";

function signToken(
  app: FastifyInstance,
  role: JwtRole,
  sub = "test-user",
  username = "testuser",
  displayName = "Test User"
): string {
  return (app as FastifyInstance & { jwt: { sign: (payload: object) => string } })
    .jwt.sign({ sub, role, username, displayName });
}

describe("Work Order route authentication (GST-52)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  // Case 1: GET /work-orders — no JWT → 401
  it("GET /work-orders without JWT returns 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/work-orders" });
    expect(res.statusCode).toBe(401);
  });

  // Case 2: GET /work-orders — operator JWT → 200
  it("GET /work-orders with operator JWT returns 200", async () => {
    const token = signToken(app, "operator");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/work-orders",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  // Case 3: GET /work-orders — supervisor JWT → 200
  it("GET /work-orders with supervisor JWT returns 200", async () => {
    const token = signToken(app, "supervisor");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/work-orders",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  // Case 4: POST /work-orders — no JWT → 401
  it("POST /work-orders without JWT returns 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/work-orders",
      payload: { title: "Test WO", productId: "PROD-1", quantity: 10, unit: "pcs" },
    });
    expect(res.statusCode).toBe(401);
  });

  // Case 5: POST /work-orders — operator JWT → 403
  it("POST /work-orders with operator JWT returns 403", async () => {
    const token = signToken(app, "operator");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/work-orders",
      headers: { Authorization: `Bearer ${token}` },
      payload: { title: "Test WO", productId: "PROD-1", quantity: 10, unit: "pcs" },
    });
    expect(res.statusCode).toBe(403);
  });

  // Case 6: POST /work-orders — supervisor JWT → 201
  it("POST /work-orders with supervisor JWT returns 201", async () => {
    const token = signToken(app, "supervisor", "user-sup-001", "mjones", "Mike Jones");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/work-orders",
      headers: { Authorization: `Bearer ${token}` },
      payload: { title: "Supervisor WO", productId: "PROD-2", quantity: 5, unit: "EA" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ createdBy: string }>();
    expect(body.createdBy).toBe("user-sup-001");
  });

  // Case 7: POST /work-orders — admin JWT → 201
  it("POST /work-orders with admin JWT returns 201", async () => {
    const token = signToken(app, "admin", "user-adm-001", "admin", "System Admin");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/work-orders",
      headers: { Authorization: `Bearer ${token}` },
      payload: { title: "Admin WO", productId: "PROD-3", quantity: 20, unit: "pcs" },
    });
    expect(res.statusCode).toBe(201);
  });

  // Case 8: PATCH /:id/transition — no JWT → 401
  it("PATCH /work-orders/:id/transition without JWT returns 401", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/work-orders/wo-nonexistent/transition",
      payload: { event: "start" },
    });
    expect(res.statusCode).toBe(401);
  });

  // Case 9: PATCH /:id/transition — operator JWT → 404 (WO not found, but auth passes)
  it("PATCH /work-orders/:id/transition with operator JWT passes auth (returns 404 for absent WO)", async () => {
    const token = signToken(app, "operator");
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/work-orders/wo-nonexistent/transition",
      headers: { Authorization: `Bearer ${token}` },
      payload: { event: "start" },
    });
    // Auth passes (not 401/403); route returns 404 since WO doesn't exist
    expect(res.statusCode).toBe(404);
  });

  // Case 10: GET /work-orders/:id — no JWT → 401
  it("GET /work-orders/:id without JWT returns 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/work-orders/wo-any",
    });
    expect(res.statusCode).toBe(401);
  });
});
