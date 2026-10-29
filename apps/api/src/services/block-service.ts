import { and, eq, or } from "drizzle-orm";
import type { AppDatabase } from "../db/client";
import { blocks } from "../db/schema";

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
}
