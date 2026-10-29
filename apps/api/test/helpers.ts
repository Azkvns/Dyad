import { sql } from "drizzle-orm";
import type { AppDatabase } from "../src/db/client";

export function sessionCookie(response: { headers: Record<string, string | string[] | undefined> }) {
  const raw = response.headers["set-cookie"];
  const header = Array.isArray(raw) ? raw.join("\n") : String(raw ?? "");
  const match = /dyad_session=([^;]+)/.exec(header);
  if (!match?.[1]) throw new Error(`missing dyad_session: ${header}`);
  return { token: decodeURIComponent(match[1]), header };
}

export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is required");
  return url;
}

export async function resetDatabase(db: AppDatabase): Promise<void> {
  await db.execute(sql`
    truncate table
      reports,
      messages,
      dialog_cursors,
      blocks,
      dialogs,
      sessions,
      users
    restart identity cascade
  `);
}

export async function expectSqlstate(promise: Promise<unknown>, sqlstate: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    const codes: string[] = [];
    const queue: unknown[] = [error];
    const seen = new Set<unknown>();
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || typeof current !== "object" || seen.has(current)) continue;
      seen.add(current);
      const row = current as { code?: unknown; cause?: unknown };
      if (typeof row.code === "string") codes.push(row.code);
      if ("cause" in row) queue.push(row.cause);
    }
    if (!codes.includes(sqlstate)) {
      throw new Error(`expected sqlstate ${sqlstate}, got ${codes.join(",") || "none"}`);
    }
    return;
  }
  throw new Error(`expected sqlstate ${sqlstate}`);
}
