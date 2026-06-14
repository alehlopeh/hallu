// SQLite backend via Bun's built-in driver - no external DB to stand up.

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { SqliteConfig } from "./index.ts";
import { type Backend, type Conn, type SqlOk, type SqlErr, SINGLE, MAX_ROWS, sanitizeAccount } from "./backend.ts";

/** Opens a DB at `path`, creates any missing tables, and seeds once if freshly created. */
export function openDb(config: SqliteConfig, path: string = config.database?.path ?? "./hallu.db"): Database {
  const fresh = path !== ":memory:" && !existsSync(path);
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

  for (const [table, columns] of Object.entries(config.tables ?? {})) {
    db.run(createTableSql(table, columns));
  }
  if ((fresh || path === ":memory:") && config.seed) config.seed(db);
  return db;
}

function createTableSql(table: string, columns: Record<string, string>): string {
  const defs = Object.entries(columns)
    .map(([name, type]) => `  ${name} ${type}`)
    .join(",\n");
  return `CREATE TABLE IF NOT EXISTS ${table} (\n${defs}\n);`;
}

/**
 * The LIVE schema as DDL, read from the DB each request. This is the source of
 * truth fed to the model - so tables the model creates on the fly persist into
 * later requests, not just the ones declared in config.
 */
export function liveSchema(db: Database): string {
  const rows = db
    .query<{ sql: string }, []>(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY name",
    )
    .all();
  return rows.map((r) => `${r.sql};`).join("\n\n");
}

const READ_RE = /^\s*(select|with|pragma|explain)\b/i;

/** Runs one statement the model generated. Returns rows as JSON, or an error to retry against. */
export function runSql(db: Database, query: string): SqlOk | SqlErr {
  const q = (query ?? "").trim();
  if (!q) return { ok: false, message: "Empty query." };

  try {
    if (READ_RE.test(q)) {
      const rows = db.query(q).all() as unknown[];
      const capped = rows.slice(0, MAX_ROWS);
      const note = rows.length > MAX_ROWS ? ` (showing first ${MAX_ROWS} of ${rows.length})` : "";
      return { ok: true, mutated: false, json: `${rows.length} row(s)${note}: ${JSON.stringify(capped)}` };
    }
    const { changes, lastInsertRowid } = db.run(q);
    return {
      ok: true,
      mutated: true,
      json: JSON.stringify({ changes, last_insert_rowid: Number(lastInsertRowid) }),
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/** One SQLite file per account; the single-tenant case (no `identify`) uses one shared file. */
export class SqliteBackend implements Backend {
  private handles = new Map<string, Database>();
  constructor(private config: SqliteConfig) {}

  async acquire(account: string): Promise<Conn> {
    let db = this.handles.get(account);
    if (!db) {
      db = openDb(this.config, this.pathFor(account));
      this.handles.set(account, db);
    }
    return new SqliteConn(db);
  }

  private pathFor(account: string): string {
    if (account === SINGLE) return this.config.database?.path ?? "./hallu.db";
    return `${this.config.database?.dir ?? "./data"}/${sanitizeAccount(account)}.db`;
  }
}

class SqliteConn implements Conn {
  constructor(private db: Database) {}
  get native() {
    return this.db;
  }
  async run(query: string) {
    return runSql(this.db, query);
  }
  async schema() {
    return liveSchema(this.db);
  }
  release() {} // the handle is cached and reused; nothing to return
}
