/**
 * Resource Assignment route unit tests — GST-110
 *
 * Tests run against a minimal Fastify instance (JWT + route plugin only).
 * No DB or external services required — uses the in-memory stores.
 *
 * Coverage:
 *   Auth / access control (8 cases):
 *     1.  GET  /work-orders/:id/resource-assignments — no JWT → 401
 *     2.  GET  — operator JWT → 200
 *     3.  GET  — unknown work order → 404
 *     4.  POST /work-orders/:id/resource-assignments — operator JWT → 403
 *     5.  POST — supervisor JWT → 201
 *     6.  PATCH /resource-assignments/:id — operator JWT → 403
 *     7.  PATCH — supervisor JWT → 200
 *     8.  DELETE /resource-assignments/:id — operator JWT → 403
 *     9.  DELETE — supervisor JWT → 204
 *   CRUD correctness (6 cases):
 *     10. POST creates assignment with correct fields
 *     11. GET returns only assignments for the requested work order
 *     12. PATCH updates quantity, unit, notes, and scheduledStart/End
 *     13. PATCH clears nullable fields when null is passed
 *     14. PATCH on unknown id → 404
 *     15. DELETE removes assignment; subsequent GET returns empty list
 *     16. DELETE on unknown id → 404
 */

import Fastify, { type FastifyInstance } from "fastify";
import jwt from "@fastify/jwt";
import workOrderRoutes from "../../routes/v1/work-orders.js";
import resourceAssignmentRoutes from "../../routes/v1/resource-assignments.js";
import { resourceAssignmentStore } from "../../stores/resource-assignments.js";

const JWT_SECRET = "test-secret-for-resource-assignments";

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.register(jwt, { secret: JWT_SECRET });
  // Register work-orders so the WO store is populated for 404 checks
  app.register(workOrderRoutes, { prefix: "/api/v1" });
  app.register(resourceAssignmentRoutes, { prefix: "/api/v1" });
  await app.ready();
  return app;
}

type JwtRole = "operator" | "supervisor" | "admin" | "engineer";

function signToken(app: FastifyInstance, role: JwtRole, sub = "test-user"): string {
  return (app as FastifyInstance & { jwt: { sign: (payload: object) => string } })
    .jwt.sign({ sub, role, username: "testuser", displayName: "Test User" });
}

describe("Resource Assignment routes (GST-110)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  // Reset store before each test for isolation
  beforeEach(() => {
    resourceAssignmentStore.length = 0;
  });

  // ─── Auth / access control ────────────────────────────────────────────────

  it("1. GET without JWT returns 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/work-orders/wo-001/resource-assignments",
    });
    expect(res.statusCode).toBe(401);
  });

  it("2. GET with operator JWT returns 200 for known work order", async () => {
    const token = signToken(app, "operator");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/work-orders/wo-001/resource-assignments",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("3. GET for unknown work order returns 404", async () => {
    const token = signToken(app, "operator");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/work-orders/wo-does-not-exist/resource-assignments",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ message: string }>().message).toBe("Work order not found");
  });

  it("4. POST with operator JWT returns 403", async () => {
    const token = signToken(app, "operator");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/work-orders/wo-001/resource-assignments",
      headers: { Authorization: `Bearer ${token}` },
      payload: { resourceType: "machine", resourceId: "machine-mock-001" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("5. POST with supervisor JWT for unknown WO returns 404", async () => {
    const token = signToken(app, "supervisor");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/work-orders/wo-does-not-exist/resource-assignments",
      headers: { Authorization: `Bearer ${token}` },
      payload: { resourceType: "machine", resourceId: "machine-mock-001" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("6. PATCH with operator JWT returns 403", async () => {
    const token = signToken(app, "operator");
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/resource-assignments/ra-nonexistent",
      headers: { Authorization: `Bearer ${token}` },
      payload: { quantity: 2 },
    });
    expect(res.statusCode).toBe(403);
  });

  it("7. DELETE with operator JWT returns 403", async () => {
    const token = signToken(app, "operator");
    const res = await app.inject({
      method: "DELETE",
      url: "/api/v1/resource-assignments/ra-nonexistent",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  // ─── CRUD correctness ─────────────────────────────────────────────────────

  it("8. POST (supervisor) creates assignment with correct fields and returns 201", async () => {
    const token = signToken(app, "supervisor");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/work-orders/wo-001/resource-assignments",
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        resourceType: "machine",
        resourceId: "machine-mock-001",
        quantity: 1,
        unit: "pcs",
        notes: "Primary CNC",
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{
      id: string;
      workOrderId: string;
      resourceType: string;
      resourceId: string;
      quantity: number;
      unit: string;
      notes: string;
    }>();
    expect(body.workOrderId).toBe("wo-001");
    expect(body.resourceType).toBe("machine");
    expect(body.resourceId).toBe("machine-mock-001");
    expect(body.quantity).toBe(1);
    expect(body.unit).toBe("pcs");
    expect(body.notes).toBe("Primary CNC");
    expect(typeof body.id).toBe("string");
  });

  it("9. GET returns only assignments for the requested work order", async () => {
    const supToken = signToken(app, "supervisor");

    // Add one for wo-001 and one for wo-002
    await app.inject({
      method: "POST",
      url: "/api/v1/work-orders/wo-001/resource-assignments",
      headers: { Authorization: `Bearer ${supToken}` },
      payload: { resourceType: "operator", resourceId: "user-op-001" },
    });
    await app.inject({
      method: "POST",
      url: "/api/v1/work-orders/wo-002/resource-assignments",
      headers: { Authorization: `Bearer ${supToken}` },
      payload: { resourceType: "tool", resourceId: "tool-wrench-01" },
    });

    const opToken = signToken(app, "operator");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/work-orders/wo-001/resource-assignments",
      headers: { Authorization: `Bearer ${opToken}` },
    });
    expect(res.statusCode).toBe(200);
    const list = res.json<Array<{ workOrderId: string }>>();
    expect(list).toHaveLength(1);
    expect(list[0].workOrderId).toBe("wo-001");
  });

  it("10. PATCH (supervisor) updates quantity, unit, notes, and scheduled window", async () => {
    const supToken = signToken(app, "supervisor");

    // Create first
    const createRes = await app.inject({
      method: "POST",
      url: "/api/v1/work-orders/wo-001/resource-assignments",
      headers: { Authorization: `Bearer ${supToken}` },
      payload: { resourceType: "material", resourceId: "mat-resin-001", quantity: 5, unit: "kg" },
    });
    const { id } = createRes.json<{ id: string }>();

    // Patch it
    const patchRes = await app.inject({
      method: "PATCH",
      url: `/api/v1/resource-assignments/${id}`,
      headers: { Authorization: `Bearer ${supToken}` },
      payload: {
        quantity: 10,
        unit: "L",
        notes: "Increased batch size",
        scheduledStart: "2026-04-01T08:00:00.000Z",
        scheduledEnd: "2026-04-01T16:00:00.000Z",
      },
    });
    expect(patchRes.statusCode).toBe(200);
    const updated = patchRes.json<{
      quantity: number;
      unit: string;
      notes: string;
      scheduledStart: string;
      scheduledEnd: string;
    }>();
    expect(updated.quantity).toBe(10);
    expect(updated.unit).toBe("L");
    expect(updated.notes).toBe("Increased batch size");
    expect(updated.scheduledStart).toBeTruthy();
    expect(updated.scheduledEnd).toBeTruthy();
  });

  it("11. PATCH clears nullable fields when null is passed", async () => {
    const supToken = signToken(app, "supervisor");

    const createRes = await app.inject({
      method: "POST",
      url: "/api/v1/work-orders/wo-001/resource-assignments",
      headers: { Authorization: `Bearer ${supToken}` },
      payload: {
        resourceType: "tool",
        resourceId: "tool-001",
        notes: "some note",
        scheduledStart: "2026-04-01T08:00:00.000Z",
      },
    });
    const { id } = createRes.json<{ id: string }>();

    const patchRes = await app.inject({
      method: "PATCH",
      url: `/api/v1/resource-assignments/${id}`,
      headers: { Authorization: `Bearer ${supToken}` },
      payload: { notes: null, scheduledStart: null },
    });
    expect(patchRes.statusCode).toBe(200);
    const updated = patchRes.json<{ notes: null; scheduledStart: null }>();
    expect(updated.notes).toBeNull();
    expect(updated.scheduledStart).toBeNull();
  });

  it("12. PATCH on unknown id returns 404", async () => {
    const supToken = signToken(app, "supervisor");
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/resource-assignments/ra-does-not-exist",
      headers: { Authorization: `Bearer ${supToken}` },
      payload: { quantity: 3 },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ message: string }>().message).toBe("Resource assignment not found");
  });

  it("13. DELETE (supervisor) removes assignment; subsequent GET returns empty list", async () => {
    const supToken = signToken(app, "supervisor");

    const createRes = await app.inject({
      method: "POST",
      url: "/api/v1/work-orders/wo-001/resource-assignments",
      headers: { Authorization: `Bearer ${supToken}` },
      payload: { resourceType: "machine", resourceId: "machine-mock-002" },
    });
    const { id } = createRes.json<{ id: string }>();

    const delRes = await app.inject({
      method: "DELETE",
      url: `/api/v1/resource-assignments/${id}`,
      headers: { Authorization: `Bearer ${supToken}` },
    });
    expect(delRes.statusCode).toBe(204);

    const opToken = signToken(app, "operator");
    const getRes = await app.inject({
      method: "GET",
      url: "/api/v1/work-orders/wo-001/resource-assignments",
      headers: { Authorization: `Bearer ${opToken}` },
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json()).toEqual([]);
  });

  it("14. DELETE on unknown id returns 404", async () => {
    const supToken = signToken(app, "supervisor");
    const res = await app.inject({
      method: "DELETE",
      url: "/api/v1/resource-assignments/ra-does-not-exist",
      headers: { Authorization: `Bearer ${supToken}` },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ message: string }>().message).toBe("Resource assignment not found");
  });

  it("15. POST (admin) also creates assignment (admin role is allowed)", async () => {
    const adminToken = signToken(app, "admin");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/work-orders/wo-001/resource-assignments",
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { resourceType: "operator", resourceId: "user-op-001", quantity: 2 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ quantity: number }>().quantity).toBe(2);
  });

  it("16. POST defaults quantity to 1 when omitted", async () => {
    const supToken = signToken(app, "supervisor");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/work-orders/wo-001/resource-assignments",
      headers: { Authorization: `Bearer ${supToken}` },
      payload: { resourceType: "tool", resourceId: "tool-caliper-01" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ quantity: number }>().quantity).toBe(1);
  });
});
