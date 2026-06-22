// Schema is read live from the DB, and (when autoSchema is on) the model's
// CREATE TABLE statements flow through runSql and show up on the next read.

import { test, expect } from "bun:test";
import { openDb, liveSchema, runSql } from "../src/db.ts";
import { defineConfig } from "../src/index.ts";

function db() {
  return openDb(
    defineConfig({
      name: "t",
      description: "t",
      tables: { lists: { id: "integer primary key autoincrement", name: "text not null" } },
      database: { driver: "sqlite", path: ":memory:" },
    }),
  );
}

test("liveSchema reflects declared tables", () => {
  const schema = liveSchema(db());
  expect(schema).toContain("lists");
  expect(schema).not.toContain("sqlite_");
});

test("a CREATE TABLE flows through runSql and appears in liveSchema", () => {
  const d = db();
  const res = runSql(d, "CREATE TABLE IF NOT EXISTS notes (id integer primary key autoincrement, list_id integer references lists(id), body text)");
  expect(res.ok).toBe(true);
  if (res.ok) expect(res.mutated).toBe(true);

  const schema = liveSchema(d);
  expect(schema).toContain("notes");
  expect(schema).toContain("references lists(id)"); // relationship preserved

  // the new table is usable
  const insert = runSql(d, "INSERT INTO notes (body) VALUES ('hi')");
  expect(insert.ok).toBe(true);
});

test("runSql flags writes by actual row changes, not a leading keyword", () => {
  const d = db();

  // A row-mutating statement that begins with WITH must still register as a write (a leading-keyword
  // check would misread it as a read and skip cache invalidation / afterWrite).
  const cte = runSql(d, "WITH x AS (SELECT 'a' AS n) INSERT INTO lists (name) SELECT n FROM x");
  expect(cte.ok).toBe(true);
  if (cte.ok) expect(cte.mutated).toBe(true);

  // A read that begins with WITH is not a write.
  const read = runSql(d, "WITH x AS (SELECT name FROM lists) SELECT * FROM x");
  expect(read.ok).toBe(true);
  if (read.ok) expect(read.mutated).toBe(false);

  // An UPDATE that matches no rows changed nothing, so it is not a mutation.
  const noop = runSql(d, "UPDATE lists SET name = 'z' WHERE id = -1");
  expect(noop.ok).toBe(true);
  if (noop.ok) expect(noop.mutated).toBe(false);

  // RETURNING rows surface on a write.
  const ret = runSql(d, "INSERT INTO lists (name) VALUES ('b') RETURNING id, name");
  expect(ret.ok).toBe(true);
  if (ret.ok) {
    expect(ret.mutated).toBe(true);
    expect(ret.json).toContain('"name":"b"');
  }
});
