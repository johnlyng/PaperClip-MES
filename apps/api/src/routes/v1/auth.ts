import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { USERS, DUMMY_HASH } from "@mes/test-fixtures";

// Startup enforcement: fail fast in production if JWT_SECRET is not set.
if (process.env["NODE_ENV"] === "production" && !process.env["JWT_SECRET"]) {
  throw new Error("JWT_SECRET must be set in production");
}

// Allow E2E tests to inject additional fixture users via AUTH_FIXTURE_USERS env var.
// Format: JSON array of User objects with passwordHash fields.
let extraUsers: typeof USERS = [];
try {
  if (process.env["AUTH_FIXTURE_USERS"]) {
    extraUsers = JSON.parse(process.env["AUTH_FIXTURE_USERS"]) as typeof USERS;
  }
} catch {
  // Ignore malformed fixture env — fail open so tests aren't broken by a bad env
}

const ALL_USERS = [...USERS, ...extraUsers];

export default async function authRoutes(app: FastifyInstance) {
  // POST /api/v1/auth/login
  app.post<{ Body: { username: string; password: string } }>("/auth/login", {
    schema: {
      tags: ["Auth"],
      summary: "Login and receive a JWT",
      body: {
        type: "object",
        properties: {
          username: { type: "string" },
          password: { type: "string" },
        },
        required: ["username", "password"],
      },
      response: {
        200: {
          type: "object",
          properties: { token: { type: "string" } },
        },
        401: {
          type: "object",
          properties: {
            statusCode: { type: "number" },
            error: { type: "string" },
            message: { type: "string" },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { username, password } = request.body;
    const user = ALL_USERS.find((u) => u.username === username);

    // Always call bcrypt.compare to prevent username-enumeration via timing side-channel.
    // When user is not found, compare against DUMMY_HASH so the work factor is identical.
    const hashToVerify = user?.passwordHash ?? DUMMY_HASH;
    const valid = await bcrypt.compare(password, hashToVerify);

    if (!user || !valid) {
      return reply.status(401).send({
        statusCode: 401,
        error: "Unauthorized",
        message: "Invalid credentials",
      });
    }

    const token = app.jwt.sign(
      {
        sub: user.id,
        username: user.username,
        role: user.role,
        displayName: user.displayName,
      },
      { expiresIn: "8h" }
    );

    return { token };
  });
}
