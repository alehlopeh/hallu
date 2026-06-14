// Public API. A Hallu app is a `hallu.config.ts` that default-exports defineConfig({...}).

import type { Database } from "bun:sqlite";
import type { SQL } from "bun";
import type { Context, Hono } from "hono";
import type { LanguageModel } from "ai";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import type { LogLevel } from "./log.ts";

/** Who a request belongs to. The framework isolates by `account` - one DB per account. */
export interface Tenant {
  /** Isolation key. One SQLite file (or Postgres schema) per distinct value. Sanitized. */
  account: string;
  /**
   * Optional prose injected into the model context for this request - e.g.
   * "Acting as user alice (role: admin)." Use it to drive per-user behavior
   * *within* an account; the account boundary itself is enforced by the separate DB.
   */
  context?: string;
}

/** Shared config - everything independent of which database backend you pick. */
export interface BaseConfig {
  /** App name - shown in the document <title>. */
  name: string;
  /**
   * The domain, data, and business rules, in prose. This is the heart of the
   * app: the LLM renders every page and applies every action against this
   * description plus the schema below. Be specific about what the app is for
   * and how its data relates.
   */
  description: string;
  /**
   * Your tables. `{ tableName: { column: "<sql type + constraints>" } }`.
   * Created on boot if absent (`CREATE TABLE IF NOT EXISTS`); the column string
   * is emitted verbatim into the DDL, so write SQL for YOUR backend, e.g.
   *   sqlite:   id: "integer primary key autoincrement"
   *   postgres: id: "bigint generated always as identity primary key"
   * Optional - omit it (or pass `{}`) to declare no schema up front, which is the
   * usual pairing with `autoSchema` where the model creates tables as it goes.
   */
  tables?: Record<string, Record<string, string>>;
  /**
   * Styling guidance handed to the model so the HTML it generates matches YOUR
   * CSS. Hallu ships no stylesheet. Tell it what to use - e.g. "Style with these
   * classes from /app.css: card, btn, btn-primary, ..." or "Use Tailwind utility
   * classes." If omitted, the model is told to use clean semantic HTML.
   */
  design?: string;
  /** Raw HTML injected into <head> - load your own stylesheet/fonts here. */
  head?: string;
  /** Directory served at the web root (for your CSS, fonts, images). Relative to cwd. */
  static?: string;
  /**
   * Self-extending schema. When true, the model may CREATE new tables and
   * foreign-key relationships on the fly for a path whose data has no table yet
   * - so features materialize just by visiting. When false (default), the schema
   * is fixed to `tables` and the model is told never to run DDL.
   */
  autoSchema?: boolean;
  /**
   * Tell the model to include a small navigation menu of reasonable-sounding links
   * to related areas of the app - inferred from the domain, including sections that
   * don't formally exist yet. Combined with `autoSchema`, clicking one materializes
   * the destination, so the app becomes explorable by wandering. Default false.
   */
  navLinks?: boolean;
  /**
   * Add an "Add field" control on table index pages. Clicking it navigates to a page
   * for adding a new column to that table; on submit the model runs ALTER TABLE ADD
   * COLUMN. Lets users grow a table's shape from the UI. Default false.
   */
  addFields?: boolean;
  /**
   * Whitelist of allowed path patterns. Glob: `*` matches one path segment, `**` matches
   * any. e.g. `["/", "/lists", "/lists/*", "/admin/**"]`. When set, a request to a path that
   * matches none is blocked with a 404 BEFORE the model is called. Omit to allow every path.
   * Keep these in their own file and import them if you like.
   */
  routes?: string[];
  /**
   * Extra instructions for how the root path `/` (the app's home/index page) renders.
   * Injected into the page prompt only when rendering `/`.
   */
  indexPrompt?: string;
  /**
   * Which cached pages to drop when the model writes to the DB. Glob patterns (same syntax
   * as `routes`). The just-written page is always refreshed in place; with this set, only the
   * page just rendered plus pages matching these patterns are dropped - unrelated detail pages
   * stay cached. List the aggregate pages a write can change, e.g. `["/", "/search"]`.
   * When unset (default), ANY write invalidates EVERY cached page (safe but coarse).
   */
  invalidateOnWrite?: string[];
  /**
   * Cache rendered page HTML and serve GETs from it without a model call (default true).
   * Set false to re-render every request through the model - always live, never stale, at
   * the cost of a model call per request (no warm fast path) and no server-side cache patching.
   */
  cacheHtml?: boolean;
  /**
   * Cache an HTML *template* per `routes` pattern instead of the rendered page - so all pages of a
   * shape (e.g. every `/wiki/*`) share one template. The model produces it on the first render of
   * that shape; every later request re-renders through the model against live data, guided by the
   * template, so structure stays stable and data is never stale. A model call per request (no warm
   * fast path), but no cache invalidation. Without `routes`, templates key by exact path. Takes
   * precedence over `cacheHtml`.
   */
  cacheTemplate?: boolean;
  /**
   * Resolve which account a request belongs to (read your own session cookie /
   * token here). Return a Tenant, or null to deny. When set, the framework opens
   * a separate database per account and keys the page cache per account. When
   * omitted, the app is single-tenant. The framework never authenticates - you
   * own login; this just answers "who is this?".
   */
  identify?: (c: Context) => Tenant | null | Promise<Tenant | null>;
  /** Mount your own routes (login, logout, etc.) on the Hono app before the catch-all. */
  configure?: (app: Hono<any>) => void;
  /** Where to redirect when `identify` returns null. If unset, denied requests get 401. */
  loginPath?: string;
  /**
   * The language model that backs the app - any AI SDK provider, constructed in
   * your config. e.g. `anthropic("claude-opus-4-8")`, or an OpenAI-compatible
   * local model via `createOpenAICompatible(...)`. Provider-specific options
   * (API key, base URL, reasoning/thinking) live on the model you build here.
   */
  model: LanguageModel;
  /**
   * Provider-specific request options forwarded to the model on every call,
   * keyed by provider id. See your AI SDK provider's docs for available keys.
   */
  providerOptions?: ProviderOptions;
  /**
   * Let the model STREAM text into the page during a form (POST) action via a `stream` tool. The model
   * just calls `stream({ text })` - the framework renders it: on the first token it appends `wrapper`
   * (your markup) to the element with id `container`, then streams the text token-by-token into that
   * wrapper's innermost element. The model does NOT render or target the streamed element itself, so a
   * reply is one tool call. The model may stream more than once per action. Off by default.
   *
   *   streamResponses: { container: "messages", wrapper: '<div class="bubble"></div>' }
   *
   * When a stream ends, the framework fires a `"hallu:finalize"` DOM event on `document` so apps can
   * react (e.g. scroll the container to the bottom).
   */
  streamResponses?: { container: string; wrapper: string };
  /** Sampling temperature. Default 0.35. */
  temperature?: number;
  /** Port to listen on. Default: env PORT or 7777. */
  port?: number;
  /** Log verbosity. "debug" (default) also logs every executed SQL statement; "info" omits SQL; "silent" is quiet. */
  logLevel?: LogLevel;
  /**
   * Observe every SQL statement the model runs - for logging, auditing, or
   * feeding to a judge model. Called after each `sql` tool execution.
   */
  onSql?: (event: SqlEvent) => void;
}

/** A Hallu app backed by SQLite (the default). */
export interface SqliteConfig extends BaseConfig {
  /**
   * SQLite storage. `path` is the single-tenant file (default "./hallu.db", or ":memory:"
   * for ephemeral); `dir` is where per-account files live when `identify` is set (default
   * "./data"). Omit `database` entirely to use SQLite with all defaults.
   */
  database?: { driver: "sqlite"; path?: string; dir?: string };
  /** Optional seeding, run once after migration if the DB was just created. */
  seed?: (db: Database) => void | Promise<void>;
  /**
   * Maintain derived data (a backlinks index, denormalized counts, audit log) in your own
   * code rather than trusting the model to. Called ONCE per request that mutated the DB,
   * AFTER the response is sent (off the critical path), with the SQLite handle and the
   * request's mutating statements. Backlinks etc. update with a brief lag (eventual consistency).
   */
  afterWrite?: (db: Database, events: SqlEvent[]) => void | Promise<void>;
}

/** A Hallu app backed by Postgres - one schema per account in a single database. */
export interface PostgresConfig extends BaseConfig {
  /**
   * Postgres storage. `url` is the connection string. Isolation is schema-per-account;
   * `schema` is the schema used for the single-tenant case (no `identify`, default "public").
   */
  database: { driver: "postgres"; url: string; schema?: string };
  /** Optional seeding, run once when an account's schema is first created. Receives a Bun SQL client. */
  seed?: (sql: SQL) => void | Promise<void>;
  /**
   * Maintain derived data in your own code rather than trusting the model to. Called ONCE per
   * request that mutated the DB, AFTER the response is sent (off the critical path), with a Bun
   * SQL client (scoped to the account's schema) and the request's mutating statements.
   */
  afterWrite?: (sql: SQL, events: SqlEvent[]) => void | Promise<void>;
}

export type HalluConfig = SqliteConfig | PostgresConfig;

/** A single SQL statement the model executed, and how it went. */
export interface SqlEvent {
  query: string;
  ok: boolean;
  mutated: boolean;
  error?: string;
}

// Overloaded so the `database` discriminant drives the `seed` parameter's type:
// a SQLite app's seed gets a `Database`, a Postgres app's seed gets a Bun `SQL`.
export function defineConfig(config: SqliteConfig): SqliteConfig;
export function defineConfig(config: PostgresConfig): PostgresConfig;
export function defineConfig(config: HalluConfig): HalluConfig {
  return config;
}

export type { Database };
