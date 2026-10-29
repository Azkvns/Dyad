import { buildApp } from "./app";
import { migrateDb } from "./db/migrate";
import { readEnv } from "./env";
import { listenOptions } from "./listen";

const env = readEnv();
await migrateDb(env.DATABASE_URL);
const app = await buildApp({ databaseUrl: env.DATABASE_URL, logger: true });
await app.listen(listenOptions(env));
