"use strict";
// Isolation-only: refuses the production database regardless of the supplied plan.
let phase = "input";
const fs = require("node:fs");
const { Client } = require("pg");
const quote = (value) => '"' + value.replaceAll('"', '""') + '"';
const reviewed = new Set([
  "book_files.absolute_path",
  "books.folder_path",
  "library_dir_scan_state.dir_path",
  "library_folders.path",
  "book_dock_files.absolute_path",
  "book_dock_files.cover_path",
  "book_dock_unit_files.absolute_path",
  "upload_sessions.staging_path",
  "podcasts.local_folder_path",
  "podcast_episode_media.local_path",
  "download_client_path_mappings.local_path",
  "book_request_downloads.local_path",
]);

async function replay() {
  const plan = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const config = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
  if (plan.mode !== "plan-only" || plan.readyForIsolationReplay !== true || plan.blocked.length || !plan.operations.length)
    throw new Error("Plan is blocked");
  const groups = new Map();
  for (const operation of plan.operations) {
    const key = operation.table + "." + operation.column;
    if (!reviewed.has(key) || !Number.isSafeInteger(operation.expectedRows) || operation.expectedRows < 1) throw new Error("Unreviewed operation");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(operation);
  }
  const client = new Client({ connectionString: config.DATABASE_URL, connectionTimeoutMillis: 10000 });
  phase = "connect";
  await client.connect();
  try {
    phase = "identity";
    const identity = (await client.query("SELECT current_database() AS database")).rows[0].database;
    if (!/^bookorbit_spk_pathcheck_[a-z0-9_]+$/.test(identity)) throw new Error("Isolation database identity required");
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout='2s'");
    await client.query("SET LOCAL statement_timeout='30s'");
    const counts = {};
    for (const [key, rows] of groups) {
      phase = "rewrite:" + key;
      const table = "public." + quote(rows[0].table);
      const column = quote(rows[0].column);
      const values = [rows.map((x) => x.old), rows.map((x) => x.new), rows.map((x) => x.expectedRows)];
      const cte = "WITH changes AS (SELECT * FROM unnest($1::text[],$2::text[],$3::int[]) AS c(old,new,expected)) ";
      await client.query("LOCK TABLE " + table + " IN SHARE ROW EXCLUSIVE MODE");
      const preflight = await client.query(
        cte +
          "SELECT old FROM changes WHERE (SELECT count(*) FROM " +
          table +
          " target WHERE target." +
          column +
          "=changes.old) <> expected OR EXISTS(SELECT 1 FROM " +
          table +
          " target WHERE target." +
          column +
          "=changes.new)",
        values,
      );
      if (preflight.rowCount) throw new Error("Snapshot changed or destination already exists: " + key);
      const changed = await client.query(
        cte + "UPDATE " + table + " target SET " + column + "=changes.new FROM changes WHERE target." + column + "=changes.old",
        values,
      );
      const expected = rows.reduce((sum, x) => sum + x.expectedRows, 0);
      if (changed.rowCount !== expected) throw new Error("Updated row count differs: " + key);
      const remaining = await client.query(
        cte +
          "SELECT old FROM changes WHERE EXISTS(SELECT 1 FROM " +
          table +
          " target WHERE target." +
          column +
          "=changes.old) OR (SELECT count(*) FROM " +
          table +
          " target WHERE target." +
          column +
          "=changes.new) <> expected",
        values,
      );
      if (remaining.rowCount) throw new Error("Post-rewrite counts differ: " + key);
      counts[key] = changed.rowCount;
    }
    await client.query("COMMIT");
    process.stdout.write(JSON.stringify({ passed: true, isolationOnly: true, database: identity, updatedRows: counts }));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

replay().catch((error) => {
  process.stderr.write(
    JSON.stringify({
      passed: false,
      phase,
      code: /^[A-Z0-9]{5}$/.test(error.code || "") ? error.code : "runtime",
      transactionRolledBackOrNotBegun: true,
    }) + "\n",
  );
  process.exitCode = 1;
});
