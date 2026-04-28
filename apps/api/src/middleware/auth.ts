import type { FastifyRequest, FastifyReply } from "fastify";
import type { UserRole } from "@mes/types";

/** JWT payload shape — must match the token issued by /api/v1/auth/login */
export interface JwtPayload {
  sub: string;
  username: string;
  displayName: string;
  role: UserRole;
}

/**
 * requireAuth — preHandler that verifies the JWT.
 * Returns 401 if the token is absent or invalid.
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    reply.status(401).send({
      statusCode: 401,
      error: "Unauthorized",
      message: "A valid JWT is required",
    });
  }
}

/**
 * requireRole — preHandler factory that verifies JWT and enforces role allowlist.
 * Returns 401 when JWT is missing/invalid, 403 when role is not in the allowed set.
 * The reply.sent guard prevents a double-send when requireAuth has already replied.
 */
export function requireRole(allowed: UserRole[]): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    await requireAuth(request, reply);
    if (reply.sent) return;

    const user = request.user as JwtPayload;
    if (!allowed.includes(user.role)) {
      reply.status(403).send({
        statusCode: 403,
        error: "Forbidden",
        message: `Role '${user.role}' is not permitted. Required: ${allowed.join(", ")}`,
      });
    }
  };
}
