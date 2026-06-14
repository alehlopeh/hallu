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
