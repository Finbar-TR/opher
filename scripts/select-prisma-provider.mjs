// Auto-selects the Prisma datasource provider from DATABASE_URL so one repo works
// on SQLite locally and MySQL/PostgreSQL in production (e.g. Hostinger MySQL).
//
// Runs as the `prebuild` step. Detects the provider from the DATABASE_URL scheme:
//   mysql://…      -> mysql
//   postgres://…   -> postgresql
//   file:… / unset -> sqlite
// Reads DATABASE_URL from the environment, falling back to the .env file (plain
// `node` does not auto-load .env). Idempotent.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

function getDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = fileURLToPath(new URL("../.env", import.meta.url));
  if (existsSync(envPath)) {
    const line = readFileSync(envPath, "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith("DATABASE_URL="));
    if (line) {
      return line.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");
    }
  }
  return "";
}

const url = getDatabaseUrl();
let target = "sqlite";
if (/^postgres(ql)?:\/\//i.test(url)) target = "postgresql";
else if (/^mysql:\/\//i.test(url)) target = "mysql";

const schemaPath = fileURLToPath(new URL("../prisma/schema.prisma", import.meta.url));
const original = readFileSync(schemaPath, "utf8");
const updated = original.replace(
  /provider = "(sqlite|postgresql|mysql)"/,
  `provider = "${target}"`
);
writeFileSync(schemaPath, updated);

console.log(`[prisma] datasource provider -> ${target}`);
