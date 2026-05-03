/**
 * Production Schedule route integration tests — GST-108
 *
 * Tests run against a minimal Fastify instance with JWT + schedule plugin.
 * A mock IScheduleService is injected via options — no real DB required.
 *
 * Coverage:
 *   Auth:
 *     1.  GET /production-schedules — no JWT → 401
 *     2.  GET /production-schedules — operator JWT → 200
 *     3.  POST /production-schedules — operator JWT → 403
 *     4.  DELETE /production-schedules/:id — operator JWT → 403
 *
 *   Happy path:
 *     5.  GET /production-schedules — returns all schedules
 *     6.  GET /production-schedules?machineId=X — returns filtered list
 *     7.  GET /production-schedules/:id — returns single schedule
 *     8.  GET /production-schedules/:nonexistent — 404
 *     9.  POST /production-schedules — supervisor creates schedule → 201
 *     10. PATCH /production-schedules/:id — supervisor updates status draft→confirmed → 200
 *     11. DELETE /production-schedules/:id — supervisor deletes draft → 204
 *
 *   Overlap conflict:
 *     12. POST /production-schedules — overlapping window → 409 with clear message
 *     13. PATCH /production-schedules/:id — overlapping new window → 409
 *
 *   Validation:
 *     14. POST — scheduledStart >= scheduledEnd → 400
 *     15. PATCH — invalid status transition (draft→active) → 422
 *     16. DELETE — non-draft/cancelled schedule → 422
 */

import Fastify, { type FastifyInstance } from "fastify";
import jwt from "@fastify/jwt";
import productionScheduleRoutes from "../../routes/v1/production-schedules.js";
import type {
  IScheduleService,
  ScheduleListFilters,
  ScheduleCreateData,
  ScheduleUpdateData,
  ScheduleConflict,
} from "../../services/ScheduleService.js";
import type { ProductionScheduleRow } from "@mes/db";

// ─── In-memory mock service ───────────────────────────────────────────────────

function makeSchedule(overrides: Partial<ProductionScheduleRow> = {}): ProductionScheduleRow {
  return {
    id: `sched-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    workOrderId: "wo-001",
    machineId: "machine-001",
    lineId: null,
    sequenceNumber: 0,
    scheduledStart: new Date("2025-06-01T08:00:00Z"),
    scheduledEnd: new Date("2025-06-01T12:00:00Z"),
    actualStart: null,
    actualEnd: null,
    shiftId: null,
    operatorId: null,
    status: "draft",
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

class MockScheduleService implements IScheduleService {
  private store: ProductionScheduleRow[] = [];
  private nextConflict: ScheduleConflict | null = null;

  /** Test helper: seed initial records */
  seed(records: ProductionScheduleRow[]) {
    this.store = [...records];
  }

  /** Test helper: force the next checkMachineOverlap call to return a conflict */
  forceConflict(conflict: ScheduleConflict) {
    this.nextConflict = conflict;
  }

  /** Test helper: clear forced conflict */
  clearConflict() {
    this.nextConflict = null;
  }

  async checkMachineOverlap(
    _machineId: string,
    _start: Date,
    _end: Date,
    _excludeId?: string
  ): Promise<ScheduleConflict | null> {
    const conflict = this.nextConflict;
    this.nextConflict = null; // consume
    return conflict;
  }

  async list(filters: ScheduleListFilters): Promise<ProductionScheduleRow[]> {
    return this.store.filter((s) => {
      if (filters.workOrderId && s.workOrderId !== filters.workOrderId) return false;
      if (filters.machineId && s.machineId !== filters.machineId) return false;
      if (filters.status && s.status !== filters.status) return false;
      if (filters.from && s.scheduledStart < filters.from) return false;
      if (filters.to && s.scheduledStart >= filters.to) return false;
      return true;
    });
  }

  async getById(id: string): Promise<ProductionScheduleRow | undefined> {
    return this.store.find((s) => s.id === id);
  }

  async create(data: ScheduleCreateData): Promise<ProductionScheduleRow> {
    const record = makeSchedule({
      id: `sched-new-${Date.now()}`,
      workOrderId: data.workOrderId,
      machineId: data.machineId,
      scheduledStart: data.scheduledStart,
      scheduledEnd: data.scheduledEnd,
      lineId: data.lineId ?? null,
      sequenceNumber: data.sequenceNumber ?? 0,
      shiftId: data.shiftId ?? null,
      operatorId: data.operatorId ?? null,
      status: data.status ?? "draft",
      notes: data.notes ?? null,
    });
    this.store.push(record);
    return record;
  }

  async update(id: string, data: ScheduleUpdateData): Promise<ProductionScheduleRow | undefined> {
    const idx = this.store.findIndex((s) => s.id === id);
    if (idx === -1) return undefined;
    const updated = { ...this.store[idx], ...data, updatedAt: new Date() };
    this.store[idx] = updated;
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    const idx = this.store.findIndex((s) => s.id === id);
    if (idx === -1) return false;
    this.store.splice(idx, 1);
    return true;
  }
}

// ─── Test app factory ─────────────────────────────────────────────────────────

const JWT_SECRET = "test-secret-production-schedules";

async function buildTestApp(mockService: MockScheduleService): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.register(jwt, { secret: JWT_SECRET });
  app.register(productionScheduleRoutes, {
    prefix: "/api/v1",
    scheduleService: mockService,
  });
  await app.ready();
  return app;
}

type JwtRole = "operator" | "supervisor" | "admin" | "engineer";

function signToken(
  app: FastifyInstance,
  role: JwtRole,
  sub = "test-user"
): string {
  return (app as FastifyInstance & { jwt: { sign: (p: object) => string } })
    .jwt.sign({ sub, role, username: "testuser", displayName: "Test User" });
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("Production Schedule routes (GST-108)", () => {
  let app: FastifyInstance;
  let mockService: MockScheduleService;

  beforeAll(async () => {
    mockService = new MockScheduleService();
    app = await buildTestApp(mockService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    // Reset the mock service before each test for isolation
    mockService.seed([]);
    mockService.clearConflict();
  });

  // ── Auth tests ───────────────────────────────────────────────────────────────

  // Case 1: GET without JWT → 401
  it("GET /production-schedules without JWT returns 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/production-schedules" });
    expect(res.statusCode).toBe(401);
  });

  // Case 2: GET with operator JWT → 200
  it("GET /production-schedules with operator JWT returns 200", async () => {
    const token = signToken(app, "operator");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/production-schedules",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  // Case 3: POST with operator JWT → 403
  it("POST /production-schedules with operator JWT returns 403", async () => {
    const token = signToken(app, "operator");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/production-schedules",
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        workOrderId: "wo-001",
        machineId: "machine-001",
        scheduledStart: "2025-06-01T08:00:00Z",
        scheduledEnd: "2025-06-01T12:00:00Z",
      },
    });
    expect(res.statusCode).toBe(403);
  });

  // Case 4: DELETE with operator JWT → 403
  it("DELETE /production-schedules/:id with operator JWT returns 403", async () => {
    const token = signToken(app, "operator");
    const res = await app.inject({
      method: "DELETE",
      url: "/api/v1/production-schedules/sched-001",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  // ── Happy path ───────────────────────────────────────────────────────────────

  // Case 5: GET returns all schedules
  it("GET /production-schedules returns all schedules", async () => {
    const s1 = makeSchedule({ id: "sched-001", machineId: "machine-001" });
    const s2 = makeSchedule({ id: "sched-002", machineId: "machine-002" });
    mockService.seed([s1, s2]);

    const token = signToken(app, "operator");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/production-schedules",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<unknown[]>();
    expect(body).toHaveLength(2);
  });

  // Case 6: GET with machineId filter returns filtered list
  it("GET /production-schedules?machineId filters correctly", async () => {
    const s1 = makeSchedule({ id: "sched-001", machineId: "machine-001" });
    const s2 = makeSchedule({ id: "sched-002", machineId: "machine-002" });
    mockService.seed([s1, s2]);

    const token = signToken(app, "operator");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/production-schedules?machineId=machine-001",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ machineId: string }[]>();
    expect(body).toHaveLength(1);
    expect(body[0].machineId).toBe("machine-001");
  });

  // Case 7: GET /:id returns single schedule
  it("GET /production-schedules/:id returns the schedule", async () => {
    const schedule = makeSchedule({ id: "sched-get-001" });
    mockService.seed([schedule]);

    const token = signToken(app, "operator");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/production-schedules/sched-get-001",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ id: string }>();
    expect(body.id).toBe("sched-get-001");
  });

  // Case 8: GET /:nonexistent → 404
  it("GET /production-schedules/:id for missing record returns 404", async () => {
    const token = signToken(app, "operator");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/production-schedules/does-not-exist",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  // Case 9: POST creates schedule (supervisor) → 201
  it("POST /production-schedules with supervisor JWT creates and returns 201", async () => {
    const token = signToken(app, "supervisor");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/production-schedules",
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        workOrderId: "wo-100",
        machineId: "machine-100",
        scheduledStart: "2025-07-01T08:00:00Z",
        scheduledEnd: "2025-07-01T16:00:00Z",
        notes: "Priority run",
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ workOrderId: string; status: string }>();
    expect(body.workOrderId).toBe("wo-100");
    expect(body.status).toBe("draft");
  });

  // Case 10: PATCH updates status draft → confirmed
  it("PATCH /production-schedules/:id transitions draft→confirmed and returns 200", async () => {
    const schedule = makeSchedule({ id: "sched-patch-001", status: "draft" });
    mockService.seed([schedule]);

    const token = signToken(app, "supervisor");
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/production-schedules/sched-patch-001",
      headers: { Authorization: `Bearer ${token}` },
      payload: { status: "confirmed" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ status: string }>();
    expect(body.status).toBe("confirmed");
  });

  // Case 11: DELETE draft schedule → 204
  it("DELETE /production-schedules/:id for draft schedule returns 204", async () => {
    const schedule = makeSchedule({ id: "sched-del-001", status: "draft" });
    mockService.seed([schedule]);

    const token = signToken(app, "supervisor");
    const res = await app.inject({
      method: "DELETE",
      url: "/api/v1/production-schedules/sched-del-001",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(204);
  });

  // ── Overlap conflict ─────────────────────────────────────────────────────────

  // Case 12: POST with overlapping window → 409 with clear message
  it("POST returns 409 with conflict details when machine is already scheduled", async () => {
    mockService.forceConflict({
      id: "sched-existing-001",
      workOrderId: "wo-existing",
      machineId: "machine-001",
      scheduledStart: new Date("2025-06-01T06:00:00Z"),
      scheduledEnd: new Date("2025-06-01T10:00:00Z"),
    });

    const token = signToken(app, "supervisor");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/production-schedules",
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        workOrderId: "wo-new",
        machineId: "machine-001",
        scheduledStart: "2025-06-01T08:00:00Z",
        scheduledEnd: "2025-06-01T12:00:00Z",
      },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json<{ message: string; conflictId: string }>();
    expect(body.message).toMatch(/machine-001/);
    expect(body.conflictId).toBe("sched-existing-001");
  });

  // Case 13: PATCH with overlapping new window → 409
  it("PATCH returns 409 when updated time window overlaps an existing schedule", async () => {
    const schedule = makeSchedule({ id: "sched-patch-overlap-001", status: "draft" });
    mockService.seed([schedule]);

    mockService.forceConflict({
      id: "sched-conflict-002",
      workOrderId: "wo-other",
      machineId: "machine-001",
      scheduledStart: new Date("2025-06-01T10:00:00Z"),
      scheduledEnd: new Date("2025-06-01T14:00:00Z"),
    });

    const token = signToken(app, "supervisor");
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/production-schedules/sched-patch-overlap-001",
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        scheduledStart: "2025-06-01T09:00:00Z",
        scheduledEnd: "2025-06-01T13:00:00Z",
      },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json<{ conflictId: string }>();
    expect(body.conflictId).toBe("sched-conflict-002");
  });

  // ── Validation ───────────────────────────────────────────────────────────────

  // Case 14: POST with start >= end → 400
  it("POST returns 400 when scheduledStart is not before scheduledEnd", async () => {
    const token = signToken(app, "supervisor");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/production-schedules",
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        workOrderId: "wo-bad",
        machineId: "machine-001",
        scheduledStart: "2025-06-01T12:00:00Z",
        scheduledEnd: "2025-06-01T08:00:00Z", // before start
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ message: string }>();
    expect(body.message).toMatch(/before/);
  });

  // Case 15: PATCH with invalid status transition (draft → active) → 422
  it("PATCH returns 422 for invalid status transition draft→active", async () => {
    const schedule = makeSchedule({ id: "sched-invalid-trans-001", status: "draft" });
    mockService.seed([schedule]);

    const token = signToken(app, "supervisor");
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/production-schedules/sched-invalid-trans-001",
      headers: { Authorization: `Bearer ${token}` },
      payload: { status: "active" }, // draft → active is not allowed
    });
    expect(res.statusCode).toBe(422);
    const body = res.json<{ message: string }>();
    expect(body.message).toMatch(/draft/);
    expect(body.message).toMatch(/active/);
  });

  // Case 16: DELETE non-draft/cancelled → 422
  it("DELETE returns 422 when schedule is not in draft or cancelled status", async () => {
    const schedule = makeSchedule({ id: "sched-active-001", status: "active" });
    mockService.seed([schedule]);

    const token = signToken(app, "supervisor");
    const res = await app.inject({
      method: "DELETE",
      url: "/api/v1/production-schedules/sched-active-001",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(422);
    const body = res.json<{ message: string }>();
    expect(body.message).toMatch(/active/);
  });
});
