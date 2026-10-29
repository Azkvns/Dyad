import type { FastifyInstance, FastifyRequest } from "fastify";
import { HttpError } from "./http-error";
import { AuthService } from "./services/auth-service";

export function cookieToken(header: string | undefined): string | null {
  if (!header) return null;
  const parts = header.split(";").map((part) => part.trim());
  const pair = parts.find((part) => part.startsWith("dyad_session="));
  if (!pair) return null;
  const value = pair.slice("dyad_session=".length);
  return value ? decodeURIComponent(value) : null;
}

export async function requireUser(app: FastifyInstance, request: FastifyRequest) {
  const token = cookieToken(request.headers.cookie);
  if (!token) throw new HttpError(401, { error: "unauthorized" });
  const session = await new AuthService(app.db).readSession(token);
  if (!session) throw new HttpError(401, { error: "unauthorized" });
  return session;
}
