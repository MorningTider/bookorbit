import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
const require = createRequire("/app/package.json");
const { Pool } = require("pg");
const { drizzle } = require("drizzle-orm/node-postgres");
const schema = require("/app/dist/db/schema/index.js");
const { BookSourceJobRepository } = require("/app/dist/modules/book-source/book-source-job.repository.js");
assert.equal(process.env.BOOKORBIT_VERIFY_ISOLATED, "1");
const url = new URL(process.env.DATABASE_URL);
assert.ok(url.hostname.includes("verify") || url.pathname.includes("verify"), "An isolated database is required");
const database = "bookorbit_recovery_verify_" + randomBytes(6).toString("hex");
const admin = new Pool({ connectionString: url.href, max: 1 });
let pool,
  created = false;
try {
  await admin.query('CREATE DATABASE "' + database + '"');
  created = true;
  url.pathname = "/" + database;
  pool = new Pool({ connectionString: url.href, max: 4 });
  await pool.query(
    "CREATE TABLE users (id serial PRIMARY KEY); CREATE TABLE libraries (id serial PRIMARY KEY); CREATE TABLE library_folders (id serial PRIMARY KEY); CREATE TABLE books (id serial PRIMARY KEY)",
  );
  for (const sql of JSON.parse(await readFile("/tmp/bookorbit-job-recovery-migrations.json", "utf8"))) await pool.query(sql);
  await pool.query("INSERT INTO users(id) VALUES (7),(8); INSERT INTO libraries(id) VALUES (3),(4)");
  const repo = new BookSourceJobRepository(drizzle(pool, { schema }));
  const [a, b] = await Promise.all([repo.enqueue(7, 3, undefined, "recovery:101"), repo.enqueue(7, 3, undefined, "recovery:101")]);
  assert.equal(a.id, b.id);
  const claims = await Promise.all([repo.claim("old-worker"), repo.claim("other-worker")]);
  assert.equal(claims.filter(Boolean).length, 1);
  const old = claims.find(Boolean);
  await pool.query("UPDATE book_source_jobs SET lease_until=now()-interval '1 minute' WHERE id=$1", [old.id]);
  const replacement = new BookSourceJobRepository(drizzle(pool, { schema }));
  await replacement.claim("new-worker");
  assert.equal((await replacement.owned(old.id, 7)).status, "failed");
  assert.equal(await repo.beginImport(old.id, old.workerId, "stale write"), false);
  await replacement.retry(old.id, 7);
  const next = await replacement.claim("new-worker");
  assert.equal(next.attempts, 2);
  await repo.finish(old.id, old.workerId, { status: "completed" });
  assert.equal((await replacement.owned(old.id, 7)).status, "downloading");
  assert.equal(await replacement.beginImport(old.id, "new-worker", "Recovered job"), true);
  await pool.query("UPDATE book_source_jobs SET lease_until=now()-interval '1 minute' WHERE id=$1", [old.id]);
  await replacement.claim("after-import-crash");
  const failed = await replacement.owned(old.id, 7);
  assert.equal(failed.status, "failed");
  assert.equal(failed.retryable, false);
  await assert.rejects(() => replacement.retry(old.id, 7));
  assert.equal((await replacement.enqueue(7, 3, undefined, "recovery:101")).id, old.id);
  await assert.rejects(() => replacement.owned(old.id, 8));
  console.log(
    JSON.stringify({
      check: "postgres-job-recovery",
      checks: [
        "concurrent-deduplication",
        "single-global-claim",
        "expired-download-lease",
        "stale-worker-fenced",
        "manual-retry-after-download-interruption",
        "import-interruption-retry-blocked",
        "duplicate-import-protected",
        "user-isolation",
      ],
      passed: true,
    }),
  );
} finally {
  await pool?.end();
  if (created) await admin.query('DROP DATABASE "' + database + '"');
  await admin.end();
  console.log("temporary_recovery_database_removed");
}
