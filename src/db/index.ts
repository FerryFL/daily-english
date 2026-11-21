import "server-only";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type DB = PostgresJsDatabase<typeof schema>;
const globalForDb = globalThis as unknown as { db?: DB };

export function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/** Lazily create the Drizzle client (Supabase transaction pooler → prepare: false). */
export function getDb(): DB {
  if (globalForDb.db) return globalForDb.db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Add it to .env.local");
  globalForDb.db = drizzle({ client: postgres(url, { prepare: false }), schema });
  return globalForDb.db;
}
