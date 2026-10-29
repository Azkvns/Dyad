import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import { and, eq, gt } from "drizzle-orm";
import type { AppDatabase } from "../db/client";
import { sessions, users } from "../db/schema";
import { HttpError } from "../http-error";

const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
let dummyHash: Promise<string> | undefined;

function dummyPasswordHash(): Promise<string> {
  dummyHash ??= bcrypt.hash("dummy-password-not-a-user", 12);
  return dummyHash;
}

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  const queue: unknown[] = [error];
  const seen = new Set<unknown>();
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    const row = current as { code?: string; constraint_name?: string; constraint?: string; cause?: unknown };
    if (row.code === "23505" && (row.constraint_name === constraint || row.constraint === constraint)) {
      return true;
    }
    if ("cause" in row) queue.push(row.cause);
  }
  return false;
}

export class AuthService {
  constructor(private readonly db: AppDatabase) {}

  async register(username: string, password: string) {
    const passwordHash = await bcrypt.hash(password, 12);
    try {
      const inserted = await this.db
        .insert(users)
        .values({ username: username.toLowerCase(), passwordHash })
        .returning({ id: users.id, username: users.username });
      const user = inserted[0];
      if (!user) throw new Error("user insert returned no row");
      const token = await this.createSession(user.id);
      return { user, token };
    } catch (error) {
      if (isUniqueViolation(error, "users_username_unique")) {
        throw new HttpError(409, { error: "username_taken" });
      }
      throw error;
    }
  }

  async login(username: string, password: string) {
    const found = await this.db
      .select({ id: users.id, username: users.username, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.username, username.toLowerCase()))
      .limit(1);
    const user = found[0] ?? null;
    const hash = user?.passwordHash ?? (await dummyPasswordHash());
    const matches = await bcrypt.compare(password, hash);
    if (!user || !matches) throw new HttpError(401, { error: "invalid_credentials" });
    const token = await this.createSession(user.id);
    return { user: { id: user.id, username: user.username }, token };
  }

  async logout(token: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  }

  async readSession(token: string): Promise<{ userId: string } | null> {
    const rows = await this.db
      .select({ userId: sessions.userId })
      .from(sessions)
      .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
      .limit(1);
    const row = rows[0];
    return row ? { userId: row.userId } : null;
  }

  async me(token: string): Promise<{ id: string; username: string } | null> {
    const session = await this.readSession(token);
    if (!session) return null;
    const rows = await this.db
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);
    return rows[0] ?? null;
  }

  private async createSession(userId: string): Promise<string> {
    const token = newToken();
    await this.db.insert(sessions).values({
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + SESSION_MS),
    });
    return token;
  }
}
