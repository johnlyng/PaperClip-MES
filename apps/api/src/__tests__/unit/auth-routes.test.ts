/**
 * Auth route unit tests — GST-52 Phase 2
 *
 * Tests run against a minimal Fastify instance (JWT + auth plugin only).
 * No DB, MQTT, or external services required.
 *
 * Covers 7 cases per plan Section 9:
 *   1. Valid operator login → 200, role=operator
 *   2. Valid supervisor login → 200, role=supervisor
 *   3. Valid admin login → 200, role=admin
 *   4. Wrong password → 401, "Invalid credentials"
 *   5. Unknown username → 401, "Invalid credentials" (no enumeration)
 *   6. Missing body fields → 400
 *   7. JWT payload contains sub, username, role, displayName
 */

import Fastify, { type FastifyInstance } from "fastify";
import jwt from "@fastify/jwt";
import authRoutes from "../../routes/v1/auth.js";

const JWT_SECRET = "test-secret-for-auth-routes";

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.register(jwt, { secret: JWT_SECRET });
  app.register(authRoutes, { prefix: "/api/v1" });
  await app.ready();
  return app;
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const base64 = token.split(".")[1];
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as Record<string, unknown>;
}

describe("POST /api/v1/auth/login", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  // Case 1: Valid operator login
  it("returns 200 with token for valid operator credentials", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "jsmith", password: "dev-password" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ token: string }>();
    expect(typeof body.token).toBe("string");
    const payload = decodeJwtPayload(body.token);
    expect(payload.role).toBe("operator");
  });

  // Case 2: Valid supervisor login
  it("returns 200 with token for valid supervisor credentials", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "mjones", password: "dev-password" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ token: string }>();
    const payload = decodeJwtPayload(body.token);
    expect(payload.role).toBe("supervisor");
  });

  // Case 3: Valid admin login
  it("returns 200 with token for valid admin credentials", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "admin", password: "dev-password" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ token: string }>();
    const payload = decodeJwtPayload(body.token);
    expect(payload.role).toBe("admin");
  });

  // Case 4: Wrong password → 401
  it("returns 401 for wrong password", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "jsmith", password: "wrong-password" },
    });

    expect(res.statusCode).toBe(401);
    const body = res.json<{ message: string }>();
    expect(body.message).toBe("Invalid credentials");
  });

  // Case 5: Unknown username → 401, same message (no enumeration)
  it("returns 401 for unknown username with identical error message", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "nobody", password: "dev-password" },
    });

    expect(res.statusCode).toBe(401);
    const body = res.json<{ message: string }>();
    expect(body.message).toBe("Invalid credentials");
  });

  // Case 6: Missing body fields → 400
  it("returns 400 when required body fields are missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "jsmith" }, // missing password
    });

    expect(res.statusCode).toBe(400);
  });

  // Case 7: JWT payload contains sub, username, role, displayName
  it("JWT payload contains sub, username, role, displayName", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "mjones", password: "dev-password" },
    });

    expect(res.statusCode).toBe(200);
    const { token } = res.json<{ token: string }>();
    const payload = decodeJwtPayload(token);

    expect(payload.sub).toBe("user-sup-001");
    expect(payload.username).toBe("mjones");
    expect(payload.role).toBe("supervisor");
    expect(payload.displayName).toBe("Mike Jones");
  });
});
