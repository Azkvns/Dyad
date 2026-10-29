import { expect } from "vitest";
import type { FastifyInstance } from "fastify";
import { sessionCookie } from "./helpers";

export async function registerUser(app: FastifyInstance, username: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { username, password: "password1" },
  });
  expect(response.statusCode).toBe(201);
  const body = response.json() as { id: string; username: string };
  const { token } = sessionCookie(response);
  return { id: body.id, username: body.username, token, cookie: `dyad_session=${token}` };
}
