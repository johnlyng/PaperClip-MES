import type { FastifyInstance } from "fastify";
import { USERS } from "@mes/test-fixtures";

const DEV_PASSWORD = process.env["DEV_PASSWORD"] ?? "dev-password";

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
          properties: { message: { type: "string" } },
        },
      },
    },
  }, async (request, reply) => {
    const { username, password } = request.body;
    const user = USERS.find((u) => u.username === username);

    if (!user || password !== DEV_PASSWORD) {
      return reply.status(401).send({ message: "Invalid credentials" });
    }

    const token = app.jwt.sign({
      sub: user.id,
      username: user.username,
      role: user.role,
      displayName: user.displayName,
    });

    return { token };
  });
}
