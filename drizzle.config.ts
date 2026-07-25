import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./supabase/migrations",
  schema: "./db/schema.ts",
  dialect: "postgresql",
});
