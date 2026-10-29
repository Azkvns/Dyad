import "./load-env";
import { migrateDb } from "../src/db/migrate";
import { testDatabaseUrl } from "./helpers";

export default async function setup() {
  await migrateDb(testDatabaseUrl());
}
