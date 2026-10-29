import { and, desc, eq, or } from "drizzle-orm";
import type { AppDatabase } from "../db/client";
import { isUniqueViolation } from "../db/pg-error";
import { blocks, users } from "../db/schema";
import { UserService } from "./user-service";

export class BlockService {
  constructor(private readonly db: AppDatabase) {}

  async isBlocked(a: string, b: string): Promise<boolean> {
    const rows = await this.db
      .select({ blockerId: blocks.blockerId })
      .from(blocks)
      .where(
        or(
          and(eq(blocks.blockerId, a), eq(blocks.blockedId, b)),
          and(eq(blocks.blockerId, b), eq(blocks.blockedId, a)),
        ),
      )
      .limit(1);
    return Boolean(rows[0]);
  }

  async block(actorId: string, username: string): Promise<{ created: boolean }> {
    const peer = await new UserService(this.db).lookup(actorId, username);
    try {
      await this.db.insert(blocks).values({ blockerId: actorId, blockedId: peer.id });
      return { created: true };
    } catch (error) {
      if (isUniqueViolation(error, "blocks_blocker_id_blocked_id_pk")) return { created: false };
      throw error;
    }
  }

  async unblock(actorId: string, username: string): Promise<void> {
    const found = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, username))
      .limit(1);
    const user = found[0];
    if (!user) return;
    await this.db
      .delete(blocks)
      .where(and(eq(blocks.blockerId, actorId), eq(blocks.blockedId, user.id)));
  }

  async list(actorId: string): Promise<{ username: string }[]> {
    return this.db
      .select({ username: users.username })
      .from(blocks)
      .innerJoin(users, eq(users.id, blocks.blockedId))
      .where(eq(blocks.blockerId, actorId))
      .orderBy(desc(blocks.createdAt));
  }
}

