import { loginBodySchema, registerBodySchema, zodIssuesToFields } from "contracts";
import type { FastifyInstance } from "fastify";
import { cookieToken } from "../current-user";
import { HttpError } from "../http-error";
import { AuthService } from "../services/auth-service";
import { sessionCookieOptions } from "../session-cookie";

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const auth = new AuthService(app.db);

  app.post("/register", async (request, reply) => {
    const parsed = registerBodySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, {
        error: "validation_error",
        fields: zodIssuesToFields(parsed.error.issues),
      });
    }
    const { user, token } = await auth.register(parsed.data.username, parsed.data.password);
    reply.setCookie("dyad_session", token, sessionCookieOptions(process.env.NODE_ENV));
    return reply.status(201).send({ id: user.id, username: user.username });
  });

  app.post("/login", async (request, reply) => {
    const parsed = loginBodySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, {
        error: "validation_error",
        fields: zodIssuesToFields(parsed.error.issues),
      });
    }
    const { user, token } = await auth.login(parsed.data.username, parsed.data.password);
    reply.setCookie("dyad_session", token, sessionCookieOptions(process.env.NODE_ENV));
    return reply.status(200).send({ id: user.id, username: user.username });
  });

  app.post("/logout", async (request, reply) => {
    const token = cookieToken(request.headers.cookie);
    if (!token || !(await auth.readSession(token))) {
      throw new HttpError(401, { error: "unauthorized" });
    }
    await auth.logout(token);
    reply.clearCookie("dyad_session", { path: "/" });
    return reply.status(204).send();
  });

  app.get("/me", async (request, reply) => {
    const token = cookieToken(request.headers.cookie);
    const user = token ? await auth.me(token) : null;
    if (!user) throw new HttpError(401, { error: "unauthorized" });
    return reply.status(200).send(user);
  });
}
