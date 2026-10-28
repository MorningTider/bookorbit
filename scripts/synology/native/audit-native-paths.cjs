"use strict";
// Run against a private connection. Print an audit snapshot, never credentials.
let phase = "input";
const { Client } = require("pg");
const rules = JSON.parse(process.env.BOOKORBIT_PATH_MAP_JSON);
const quote = (value) => '"' + value.replaceAll('"', '""') + '"';

async function audit() {
  if (!Array.isArray(rules) || !rules.length || rules.length > 8) throw new Error("Invalid bounded path map");
  for (const rule of rules) {
    for (const value of [rule.from, rule.to]) {
      if (typeof value !== "string" || !value.startsWith("/") || /[\0\r\n]/.test(value)) throw new Error("Invalid path map");
    }
  }
  rules.sort((left, right) => right.from.length - left.from.length || left.from.localeCompare(right.from));
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
  phase = "connect";
  await client.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout = '5s'");
    await client.query("SET LOCAL lock_timeout = '1s'");
    const columns = await client.query(
      "SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND data_type IN ('text','character varying','json','jsonb') ORDER BY table_name,column_name",
    );
    if (columns.rows.length > 2048) throw new Error("Unexpected schema size");
    const matches = [];
    for (const column of columns.rows) {
      phase = "audit-column";
      const table = "public." + quote(column.table_name);
      const field = quote(column.column_name);
      if (["json", "jsonb"].includes(column.data_type)) {
        const pattern = "^(" + rules.map((r) => r.from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")(/|$)";
        const jsonpath = 'strict $.** ? (@.type() == "string" && @ like_regex ' + JSON.stringify(pattern) + ")";
        const found = await client.query(
          "SELECT count(*)::int AS count FROM " + table + " WHERE jsonb_path_exists(" + field + "::jsonb, $1::jsonpath)",
          [jsonpath],
        );
        if (found.rows[0].count) matches.push({ table: column.table_name, column: column.column_name, kind: "json", count: found.rows[0].count });
      } else {
        const values = rules.flatMap((rule) => [rule.from, rule.to]);
        const predicate = rules
          .map(
            (_, index) =>
              "(" + field + "=$" + (2 * index + 1) + " OR left(" + field + ",length($" + (2 * index + 1) + ")+1)=$" + (2 * index + 1) + "||'/')",
          )
          .join(" OR ");
        const destination =
          "CASE " +
          rules
            .map(
              (_, index) =>
                "WHEN matched.value=$" +
                (2 * index + 1) +
                " OR left(matched.value,length($" +
                (2 * index + 1) +
                ")+1)=$" +
                (2 * index + 1) +
                "||'/' THEN $" +
                (2 * index + 2) +
                "||substr(matched.value,length($" +
                (2 * index + 1) +
                ")+1)",
            )
            .join(" ") +
          " END";
        const sql =
          "SELECT value,count(*)::int AS count,EXISTS(SELECT 1 FROM " +
          table +
          " target WHERE target." +
          field +
          "=" +
          destination +
          ') AS "targetExists" FROM (SELECT ' +
          field +
          " AS value FROM " +
          table +
          " WHERE " +
          predicate +
          ") matched GROUP BY value";
        const found = await client.query(sql, values);
        for (const row of found.rows) matches.push({ table: column.table_name, column: column.column_name, kind: "scalar", ...row });
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await client.query("ROLLBACK");
    process.stdout.write(
      JSON.stringify({ schemaVersion: 1, readOnly: true, auditComplete: true, inspectedColumns: columns.rows.length, mappings: rules, matches }),
    );
  } finally {
    await client.end();
  }
}

audit().catch((error) => {
  process.stderr.write(
    JSON.stringify({ passed: false, phase, code: /^[A-Z0-9]{5}$/.test(error.code || "") ? error.code : "runtime", completeSnapshotProduced: false }) +
      "\n",
  );
  process.exitCode = 1;
});
