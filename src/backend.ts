// Storage abstraction. The engine talks to a `Backend` (one per app) which hands
// out a per-request, account-scoped `Conn`. SQLite and Postgres each implement it;
// the model never knows which it is talking to.

import { createHash } from "node:crypto";

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
  /** Framework-internal structured read (e.g. the `hallu_pages` edits table). Returns raw rows. */
  readRows(query: string): Promise<Record<string, unknown>[]>;
  /** Persist a page-chat edit with bound parameters (framework-authored SQL over untrusted text). */
  savePageEdit(glob: string, instruction: string): Promise<void>;
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

// 8 hex chars of SHA-256 - enough to keep distinct account keys from colliding after sanitizing.
function shortHash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 8);
}

/**
 * Account key → safe SQLite filename component. A key already in the safe charset maps to itself
 * (so clean account names stay readable); any key that needs sanitizing or could collide gets a
 * hash of the ORIGINAL appended, so distinct accounts never share a database file. A hostile key
 * still can't escape the dir.
 */
export function sanitizeAccount(account: string): string {
  const safe = account.replace(/[^A-Za-z0-9_-]/g, "_");
  if (safe === account && safe) return safe;
  return `${safe.slice(0, 40)}-${shortHash(account)}`;
}

/**
 * Account key → safe Postgres schema name (≤63 chars). As above: an already-safe, in-length key
 * maps to itself; anything that gets folded (lowercased), stripped, or truncated gets a hash of the
 * original appended, so two distinct accounts never resolve to the same schema.
 */
export function sanitizeSchema(account: string): string {
  const safe = account.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  if (safe === account && safe.length <= 63 && safe) return safe;
  return `${safe.slice(0, 54)}_${shortHash(account)}`;
}
