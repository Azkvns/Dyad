import { eq } from "drizzle-orm";
import type { AppDatabase } from "../db/client";
import { users } from "../db/schema";
import { HttpError } from "../http-error";

export class UserService {
  constructor(private readonly db: AppDatabase) {}

  async lookup(actorId: string, username: string): Promise<{ id: string; username: string }> {
    const actors = await this.db
      .select({ username: users.username })
      .from(users)
      .where(eq(users.id, actorId))
      .limit(1);
    const actor = actors[0];
    if (!actor) throw new Error("actor missing");
    if (actor.username === username) {
      throw new HttpError(400, { error: "validation_error", fields: { username: "invalid" } });
    }
    const found = await this.db
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(eq(users.username, username))
      .limit(1);
    const user = found[0];
    if (!user) throw new HttpError(404, { error: "not_found" });
    return user;
  }
}
