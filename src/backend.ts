// Storage abstraction. The engine talks to a `Backend` (one per app) which hands
// out a per-request, account-scoped `Conn`. SQLite and Postgres each implement it;
// the model never knows which it is talking to.

export interface SqlOk {
  ok: true;
  json: string;
  mutated: boolean;
}
export interface SqlErr {
  ok: false;
  message: string;
}
export type SqlResult = SqlOk | SqlErr;

/** A pinned, account-scoped connection for the duration of one request. */
export interface Conn {
  /** Run one statement the model generated. Rows as JSON, or an error to retry against. */
  run(query: string): Promise<SqlResult>;
  /** The live schema as DDL text, fed to the model so on-the-fly tables persist. */
  schema(): Promise<string>;
  /** Return the connection to its pool. No-op for SQLite. */
  release(): void;
  /**
   * The underlying driver handle - a bun:sqlite `Database` or a reserved Bun `SQL` connection.
   * Exposed for app hooks (e.g. `afterWrite`) that maintain derived data in their own code.
   */
  readonly native: unknown;
}

/** Owns provisioning (tables + one-time seed) and connections for every account. */
export interface Backend {
  /** Ensure the account's storage exists, then return a pinned connection for this request. */
  acquire(account: string): Promise<Conn>;
}

/** The single-tenant account, used when the app has no `identify`. */
export const SINGLE = " single";

export const MAX_ROWS = 200;

/** Account key → safe SQLite filename component; a hostile key can't escape the dir. */
export function sanitizeAccount(account: string): string {
  return account.replace(/[^A-Za-z0-9_-]/g, "_") || "_";
}

/** Account key → safe Postgres schema name (folded to lowercase, ≤63 chars). */
export function sanitizeSchema(account: string): string {
  return account.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 63) || "_";
}
