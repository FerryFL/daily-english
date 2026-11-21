import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local" });
config({ path: ".env" });

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  tablesFilter: ["english_*"],
  dbCredentials: { url: process.env.DATABASE_URL! },
  entities: { roles: { provider: "supabase" } },
});
