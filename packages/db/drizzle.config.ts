import type { Config } from "drizzle-kit";

// DATABASE_URL must be set in .env.local for local dev.
// Production migrations are run via drizzle-kit generate + explicit migration step in CI.
export default {
  schema: "./schema/index.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env["DATABASE_URL"] ?? "postgresql://mes:mes@localhost:5432/mes_dev",
  },
} satisfies Config;
