import "dotenv/config";
import { defineConfig } from "prisma/config";

function resolvePrismaDatabaseUrl(): string {
  const explicitUrl = (
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL ||
    ""
  ).trim();
  if (explicitUrl) return explicitUrl;

  const host = (process.env.POSTGRES_HOST || "127.0.0.1").trim();
  const port = String(process.env.POSTGRES_PORT || "5432").trim();
  const user = encodeURIComponent(
    (process.env.POSTGRES_USER || "postgres").trim(),
  );
  const password = encodeURIComponent(
    process.env.POSTGRES_PASSWORD ?? "postgres",
  );
  const database = encodeURIComponent(
    (process.env.POSTGRES_DB || "chatdesk").trim(),
  );
  const sslQuery = process.env.POSTGRES_SSL === "true" ? "?sslmode=require" : "";
  return `postgresql://${user}:${password}@${host}:${port}/${database}${sslQuery}`;
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: resolvePrismaDatabaseUrl(),
  },
});
