/**
 * Shift route unit tests — GST-116
 *
 * Tests run against a minimal Fastify instance (JWT + route plugin only).
 * No DB or external services required — uses the in-memory shiftStore.
 *
 * Coverage:
 *   Auth / access control:
 *     1.  GET  /shifts — no JWT → 401
 *     2.  GET  /shifts — operator JWT → 200 (returns active shifts by default)
 *     3.  GET  /shifts?activeOnly=false — operator JWT → 200 (all shifts)
 *     4.  GET  /shifts/:id — no JWT → 401
 *     5.  GET  /shifts/:id — operator JWT, known id → 200
 *     6.  GET  /shifts/:id — operator JWT, unknown id → 404
 *     7.  POST /shifts — operator JWT → 403
 *     8.  POST /shifts — supervisor JWT → 201
 *     9.  PATCH /shifts/:id — operator JWT → 403
 *     10. PATCH /shifts/:id — supervisor JWT → 200
 *     11. DELETE /shifts/:id — operator JWT → 403
 *     12. DELETE /shifts/:id — supervisor JWT → 204 (soft-delete)
 *   Validation:
 *     13. POST — bad startTime format → 400
 *     14. POST — bad endTime format → 400
 *     15. POST — empty daysOfWeek → 400
 *     16. POST — daysOfWeek value out of range → 400
 *     17. POST — duplicate daysOfWeek entries → 400
 *     18. POST — blank name → 400
 *   CRUD correctness:
 *     19. POST creates shift with correct fields
 *     20. PATCH updates name, times, daysOfWeek
 *     21. PATCH on unknown id → 404
 *     22. DELETE soft-deletes (isActive=false); shift remains in ?activeOnly=false list
 *     23. DELETE on unknown id → 404
 *     24. Admin role can also create/update/delete shifts
 */

import Fastify, { type FastifyInstance } from "fastify";
import jwt from "@fastify/jwt";
import shiftRoutes from "../../routes/v1/shifts.js";
import { shiftStore } from "../../stores/shifts.js";

const JWT_SECRET = "test-secret-for-shifts";

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.register(jwt, { secret: JWT_SECRET });
  app.register(shiftRoutes, { prefix: "/api/v1" });
  await app.ready();
  return app;
}

type JwtRole = "operator" | "supervisor" | "admin" | "engineer";

function signToken(app: FastifyInstance, role: JwtRole, sub = "test-user"): string {
  return (app as FastifyInstance & { jwt: { sign: (payload: object) => string } })
    .jwt.sign({ sub, role, username: "testuser", displayName: "Test User" });
}

describe("Shift routes (GST-116)", () => {
  let app: FastifyInstance;
  let originalStore: typeof shiftStore;

  beforeAll(async () => {
    app = await buildTestApp();
    // Snapshot seed data so we can restore it
    originalStore = [...shiftStore];
  });

  afterAll(async () => {
    await app.close();
  });

  // Restore seed data before each test for isolation
  beforeEach(() => {
    shiftStore.length = 0;
    shiftStore.push(...originalStore.map(s => ({ ...s })));
  });

  // ─── Auth / access control ────────────────────────────────────────────────

  it("1. GET /shifts without JWT returns 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/shifts" });
    expect(res.statusCode).toBe(401);
  });

  it("2. GET /shifts with operator JWT returns 200 and active shifts", async () => {
    const token = signToken(app, "operator");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/shifts",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const list = res.json<Array<{ isActive: boolean }>>();
    expect(Array.isArray(list)).toBe(true);
    expect(list.every(s => s.isActive)).toBe(true);
  });

  it("3. GET /shifts?activeOnly=false returns all shifts including inactive", async () => {
    const supToken = signToken(app, "supervisor");
    // Deactivate one shift first
    const listRes = await app.inject({
      method: "GET",
      url: "/api/v1/shifts",
      headers: { Authorization: `Bearer ${supToken}` },
    });
    const [first] = listRes.json<Array<{ id: string }>>();

    await app.inject({
      method: "DELETE",
      url: `/api/v1/shifts/${first.id}`,
      headers: { Authorization: `Bearer ${supToken}` },
    });

    const opToken = signToken(app, "operator");
    const allRes = await app.inject({
      method: "GET",
      url: "/api/v1/shifts?activeOnly=false",
      headers: { Authorization: `Bearer ${opToken}` },
    });
    expect(allRes.statusCode).toBe(200);
    const all = allRes.json<Array<{ isActive: boolean }>>();
    expect(all.some(s => !s.isActive)).toBe(true);
  });

  it("4. GET /shifts/:id without JWT returns 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/shifts/shift-morning" });
    expect(res.statusCode).toBe(401);
  });

  it("5. GET /shifts/:id with operator JWT for known id returns 200", async () => {
    const token = signToken(app, "operator");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/shifts/shift-morning",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ id: string }>().id).toBe("shift-morning");
  });

  it("6. GET /shifts/:id for unknown id returns 404", async () => {
    const token = signToken(app, "operator");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/shifts/shift-does-not-exist",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ message: string }>().message).toBe("Shift not found");
  });

  it("7. POST /shifts with operator JWT returns 403", async () => {
    const token = signToken(app, "operator");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/shifts",
      headers: { Authorization: `Bearer ${token}` },
      payload: { name: "Test", startTime: "08:00", endTime: "16:00", daysOfWeek: [1, 2, 3] },
    });
    expect(res.statusCode).toBe(403);
  });

  it("8. POST /shifts with supervisor JWT returns 201", async () => {
    const token = signToken(app, "supervisor");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/shifts",
      headers: { Authorization: `Bearer ${token}` },
      payload: { name: "Test Shift", startTime: "08:00", endTime: "16:00", daysOfWeek: [1, 2, 3] },
    });
    expect(res.statusCode).toBe(201);
  });

  it("9. PATCH /shifts/:id with operator JWT returns 403", async () => {
    const token = signToken(app, "operator");
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/shifts/shift-morning",
      headers: { Authorization: `Bearer ${token}` },
      payload: { name: "Renamed" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("10. PATCH /shifts/:id with supervisor JWT returns 200", async () => {
    const token = signToken(app, "supervisor");
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/shifts/shift-morning",
      headers: { Authorization: `Bearer ${token}` },
      payload: { name: "Early Morning" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ name: string }>().name).toBe("Early Morning");
  });

  it("11. DELETE /shifts/:id with operator JWT returns 403", async () => {
    const token = signToken(app, "operator");
    const res = await app.inject({
      method: "DELETE",
      url: "/api/v1/shifts/shift-morning",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("12. DELETE /shifts/:id with supervisor JWT returns 204 (soft-delete)", async () => {
    const token = signToken(app, "supervisor");
    const res = await app.inject({
      method: "DELETE",
      url: "/api/v1/shifts/shift-morning",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(204);
  });

  // ─── Validation ───────────────────────────────────────────────────────────

  it("13. POST — bad startTime format returns 400", async () => {
    const token = signToken(app, "supervisor");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/shifts",
      headers: { Authorization: `Bearer ${token}` },
      payload: { name: "Bad", startTime: "8am", endTime: "16:00", daysOfWeek: [1] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ message: string }>().message).toMatch(/startTime/);
  });

  it("14. POST — bad endTime format returns 400", async () => {
    const token = signToken(app, "supervisor");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/shifts",
      headers: { Authorization: `Bearer ${token}` },
      payload: { name: "Bad", startTime: "08:00", endTime: "4pm", daysOfWeek: [1] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ message: string }>().message).toMatch(/endTime/);
  });

  it("15. POST — empty daysOfWeek returns 400", async () => {
    const token = signToken(app, "supervisor");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/shifts",
      headers: { Authorization: `Bearer ${token}` },
      payload: { name: "Bad", startTime: "08:00", endTime: "16:00", daysOfWeek: [] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ message: string }>().message).toMatch(/daysOfWeek/);
  });

  it("16. POST — daysOfWeek value out of range (7) returns 400", async () => {
    const token = signToken(app, "supervisor");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/shifts",
      headers: { Authorization: `Bearer ${token}` },
      payload: { name: "Bad", startTime: "08:00", endTime: "16:00", daysOfWeek: [1, 7] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ message: string }>().message).toMatch(/0–6/);
  });

  it("17. POST — duplicate daysOfWeek entries returns 400", async () => {
    const token = signToken(app, "supervisor");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/shifts",
      headers: { Authorization: `Bearer ${token}` },
      payload: { name: "Bad", startTime: "08:00", endTime: "16:00", daysOfWeek: [1, 1, 2] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ message: string }>().message).toMatch(/duplicate/i);
  });

  it("18. POST — blank name returns 400", async () => {
    const token = signToken(app, "supervisor");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/shifts",
      headers: { Authorization: `Bearer ${token}` },
      payload: { name: "   ", startTime: "08:00", endTime: "16:00", daysOfWeek: [1] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ message: string }>().message).toMatch(/name/);
  });

  // ─── CRUD correctness ─────────────────────────────────────────────────────

  it("19. POST creates shift with correct fields", async () => {
    const token = signToken(app, "supervisor");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/shifts",
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        name: "Weekend",
        startTime: "07:00",
        endTime: "15:00",
        daysOfWeek: [0, 6],
        isActive: true,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{
      id: string;
      name: string;
      startTime: string;
      endTime: string;
      daysOfWeek: number[];
      isActive: boolean;
    }>();
    expect(typeof body.id).toBe("string");
    expect(body.name).toBe("Weekend");
    expect(body.startTime).toBe("07:00");
    expect(body.endTime).toBe("15:00");
    expect(body.daysOfWeek).toEqual([0, 6]);
    expect(body.isActive).toBe(true);
  });

  it("20. PATCH updates name, startTime, endTime, and daysOfWeek", async () => {
    const token = signToken(app, "supervisor");
    const patchRes = await app.inject({
      method: "PATCH",
      url: "/api/v1/shifts/shift-afternoon",
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        name: "Mid-Day",
        startTime: "12:00",
        endTime: "20:00",
        daysOfWeek: [1, 3, 5],
      },
    });
    expect(patchRes.statusCode).toBe(200);
    const updated = patchRes.json<{
      name: string;
      startTime: string;
      endTime: string;
      daysOfWeek: number[];
    }>();
    expect(updated.name).toBe("Mid-Day");
    expect(updated.startTime).toBe("12:00");
    expect(updated.endTime).toBe("20:00");
    expect(updated.daysOfWeek).toEqual([1, 3, 5]);
  });

  it("21. PATCH on unknown id returns 404", async () => {
    const token = signToken(app, "supervisor");
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/shifts/shift-does-not-exist",
      headers: { Authorization: `Bearer ${token}` },
      payload: { name: "Ghost" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ message: string }>().message).toBe("Shift not found");
  });

  it("22. DELETE soft-deletes: shift stays in ?activeOnly=false list with isActive=false", async () => {
    const supToken = signToken(app, "supervisor");

    // Soft-delete morning shift
    const delRes = await app.inject({
      method: "DELETE",
      url: "/api/v1/shifts/shift-morning",
      headers: { Authorization: `Bearer ${supToken}` },
    });
    expect(delRes.statusCode).toBe(204);

    // Should not appear in default active list
    const opToken = signToken(app, "operator");
    const activeRes = await app.inject({
      method: "GET",
      url: "/api/v1/shifts",
      headers: { Authorization: `Bearer ${opToken}` },
    });
    const activeList = activeRes.json<Array<{ id: string }>>();
    expect(activeList.find(s => s.id === "shift-morning")).toBeUndefined();

    // But should appear in full list with isActive=false
    const allRes = await app.inject({
      method: "GET",
      url: "/api/v1/shifts?activeOnly=false",
      headers: { Authorization: `Bearer ${opToken}` },
    });
    const allList = allRes.json<Array<{ id: string; isActive: boolean }>>();
    const found = allList.find(s => s.id === "shift-morning");
    expect(found).toBeDefined();
    expect(found?.isActive).toBe(false);
  });

  it("23. DELETE on unknown id returns 404", async () => {
    const token = signToken(app, "supervisor");
    const res = await app.inject({
      method: "DELETE",
      url: "/api/v1/shifts/shift-does-not-exist",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ message: string }>().message).toBe("Shift not found");
  });

  it("24. Admin role can create, update, and delete shifts", async () => {
    const adminToken = signToken(app, "admin");

    // Create
    const createRes = await app.inject({
      method: "POST",
      url: "/api/v1/shifts",
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { name: "Admin Shift", startTime: "09:00", endTime: "17:00", daysOfWeek: [1, 2] },
    });
    expect(createRes.statusCode).toBe(201);
    const { id } = createRes.json<{ id: string }>();

    // Update
    const patchRes = await app.inject({
      method: "PATCH",
      url: `/api/v1/shifts/${id}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { name: "Admin Shift Updated" },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json<{ name: string }>().name).toBe("Admin Shift Updated");

    // Delete
    const delRes = await app.inject({
      method: "DELETE",
      url: `/api/v1/shifts/${id}`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(delRes.statusCode).toBe(204);
  });
});
