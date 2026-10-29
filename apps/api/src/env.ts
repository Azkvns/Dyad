export function readEnv(source: NodeJS.ProcessEnv = process.env) {
  const databaseUrl = source.DATABASE_URL;
  if (!databaseUrl) throw new Error("invalid environment");
  const port = source.PORT === undefined ? 3000 : Number(source.PORT);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("invalid environment");
  }
  return {
    DATABASE_URL: databaseUrl,
    PORT: port,
    NODE_ENV: source.NODE_ENV ?? "development",
  };
}
