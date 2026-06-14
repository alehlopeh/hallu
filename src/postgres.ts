// Postgres backend via Bun's native SQL driver. Isolation is schema-per-account:
// one Postgres database (the `url`), one schema per account, `search_path` pinned
// per request on a reserved connection.

import { SQL } from "bun";
import type { PostgresConfig } from "./index.ts";
import { type Backend, type Conn, type SqlResult, SINGLE, MAX_ROWS, sanitizeSchema } from "./backend.ts";

const WRITE_RE = /^(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|MERGE)/i;

export class PgBackend implements Backend {
  private pool: SQL;
  private ready = new Map<string, Promise<void>>(); // schema → provisioning, run once
  constructor(private config: PostgresConfig) {
    this.pool = new SQL(config.database.url);
  }

  async acquire(account: string): Promise<Conn> {
    const schema = this.schemaFor(account);
    await (this.ready.get(schema) ?? this.provision(schema));

    const conn = await this.pool.reserve();
    await conn.unsafe(`SET search_path TO "${schema}"`);
    return new PgConn(conn, schema);
  }

  private schemaFor(account: string): string {
    if (account === SINGLE) return this.config.database.schema ?? "public";
    return sanitizeSchema(account);
  }

  private provision(schema: string): Promise<void> {
    const p = (async () => {
      const existed = (await this.pool.unsafe(`SELECT 1 FROM information_schema.schemata WHERE schema_name = '${schema}'`)).length > 0;
      await this.pool.unsafe(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
      for (const [table, columns] of Object.entries(this.config.tables ?? {})) {
        await this.pool.unsafe(`CREATE TABLE IF NOT EXISTS "${schema}"."${table}" (\n${columnDefs(columns)}\n)`);
      }
      if (!existed && this.config.seed) {
        const conn = await this.pool.reserve();
        try {
          await conn.unsafe(`SET search_path TO "${schema}"`);
          await this.config.seed(conn as unknown as SQL);
        } finally {
          conn.release();
        }
      }
    })();
    this.ready.set(schema, p);
    return p;
  }
}

function columnDefs(columns: Record<string, string>): string {
  return Object.entries(columns)
    .map(([name, type]) => `  ${name} ${type}`)
    .join(",\n");
}

class PgConn implements Conn {
  constructor(
    private conn: Awaited<ReturnType<SQL["reserve"]>>,
    private schemaName: string,
  ) {}

  get native() {
    return this.conn;
  }

  async run(query: string): Promise<SqlResult> {
    const q = (query ?? "").trim();
    if (!q) return { ok: false, message: "Empty query." };
    try {
      const result = (await this.conn.unsafe(q)) as unknown[] & { command?: string; count?: number };
      const command = result.command ?? "";
      const rows = result as unknown[];
      if (WRITE_RE.test(command)) {
        const changes = result.count ?? rows.length;
        // Surface RETURNING rows if the model asked for them; otherwise just the count.
        const json = rows.length ? JSON.stringify({ changes, rows: rows.slice(0, MAX_ROWS) }) : JSON.stringify({ changes });
        return { ok: true, mutated: true, json };
      }
      const capped = rows.slice(0, MAX_ROWS);
      const note = rows.length > MAX_ROWS ? ` (showing first ${MAX_ROWS} of ${rows.length})` : "";
      return { ok: true, mutated: false, json: `${rows.length} row(s)${note}: ${JSON.stringify(capped)}` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  async schema(): Promise<string> {
    const rows = (await this.conn.unsafe(
      `SELECT table_name, column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = '${this.schemaName}'
       ORDER BY table_name, ordinal_position`,
    )) as Array<{ table_name: string; column_name: string; data_type: string; is_nullable: string; column_default: string | null }>;

    const byTable = new Map<string, string[]>();
    for (const r of rows) {
      const col =
        `  ${r.column_name} ${r.data_type}` +
        (r.is_nullable === "NO" ? " not null" : "") +
        (r.column_default ? ` default ${r.column_default}` : "");
      (byTable.get(r.table_name) ?? byTable.set(r.table_name, []).get(r.table_name)!).push(col);
    }
    return [...byTable.entries()].map(([t, cols]) => `CREATE TABLE ${t} (\n${cols.join(",\n")}\n);`).join("\n\n");
  }

  release() {
    this.conn.release();
  }
}
