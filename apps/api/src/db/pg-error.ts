export function isUniqueViolation(error: unknown, constraint: string): boolean {
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
