/**
 * Apply a .sql file to the local dev Postgres — `npm run db:schema` /
 * `db:seed`. Uses the repo's own `pg` (no psql in PATH, no docker needed)
 * and honors DATABASE_URL, falling back to the same local Postgres
 * `src/lib/db.ts` uses (postgresql://alapar:alapar@localhost:5432/alapar).
 *
 * Runs inside a transaction: a failure rolls back cleanly and prints a
 * friendly note (the common case is re-running schema/seed over an already
 * populated database — "ya existe"/"duplicate key" just means "applied").
 */
import pg from "pg";
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/apply-sql.mjs <file.sql>");
  process.exit(1);
}

const LOCAL_FALLBACK = "postgresql://alapar:alapar@localhost:5432/alapar";
const connectionString = process.env.DATABASE_URL ?? LOCAL_FALLBACK;
const sql = readFileSync(file, "utf8");

const client = new pg.Client({ connectionString, ssl: false });
try {
  await client.connect();
  await client.query("BEGIN");
  await client.query(sql);
  await client.query("COMMIT");
  console.log(`✓ ${file} aplicado`);
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  const msg = String(err.message ?? err);
  if (/ya existe|already exists|duplicate key|duplica/i.test(msg)) {
    console.log(`= ${file}: ya estaba aplicado (sin cambios)`);
  } else {
    console.error(`✗ ${file}: ${msg}`);
    process.exit(1);
  }
} finally {
  await client.end();
}
