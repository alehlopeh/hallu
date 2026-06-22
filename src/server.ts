// Builds the Hono app: a catch-all that hands every request to the model.

import { Hono } from "hono";
import { stream } from "hono/streaming";
import { serveStatic } from "hono/bun";
import type { HalluConfig, SqliteConfig, PostgresConfig, SqlEvent } from "./index.ts";
import { SqliteBackend } from "./db.ts";
import { PgBackend } from "./postgres.ts";
import { type Backend, type Conn, SINGLE } from "./backend.ts";
import { PageCache } from "./cache.ts";
import { page } from "./page.ts";
import { renderPage, renderChrome, handleAction, handleActionStream } from "./llm.ts";
import { applyUpdates, innerOf, serializeUpdate, type Update } from "./dom.ts";
import { setLogLevel, info } from "./log.ts";

// One cache (+ generated nav) per account. The connection itself is owned by the backend.
interface Store {
  cache: PageCache;
  chrome?: string;
}

type Env = { Variables: { store: Store; ctx?: string; account: string } };

function createBackend(config: HalluConfig): Backend {
  return config.database?.driver === "postgres"
    ? new PgBackend(config as PostgresConfig)
    : new SqliteBackend(config as SqliteConfig);
}

// Fire `afterWrite` once per mutating request, off the request's critical path. It re-acquires its
// own connection (independent of the request's), so derived data updates with a brief lag (eventual
// consistency). Fire-and-forget: a failure is logged, never surfaced to the user.
function deferAfterWrite(backend: Backend, account: string, config: HalluConfig, writes: SqlEvent[]): void {
  if (!config.afterWrite || writes.length === 0) return;
  const hook = config.afterWrite as (native: unknown, events: SqlEvent[]) => void | Promise<void>;
  void (async () => {
    let conn: Conn | undefined;
    try {
      conn = await backend.acquire(account);
      await hook(conn.native, writes);
    } catch (e) {
      info(`afterWrite error: ${e instanceof Error ? e.message : e}`);
    } finally {
      conn?.release();
    }
  })();
}

export function createApp(config: HalluConfig): Hono<Env> {
  setLogLevel(config.logLevel ?? "debug");
  const app = new Hono<Env>();
  const backend = createBackend(config);
  const stores = new Map<string, Store>();

  const storeFor = (account: string): Store => {
    let s = stores.get(account);
    if (!s) {
      // Template mode keeps the cache on to hold per-path templates, even if cacheHtml is off.
      s = { cache: new PageCache(config.cacheTemplate === true || config.cacheHtml !== false) };
      stores.set(account, s);
    }
    return s;
  };

  const clientJs = Bun.file(new URL("./client.js", import.meta.url));
  app.get("/__hallu/client.js", () => {
    return new Response(clientJs, { headers: { "content-type": "application/javascript; charset=utf-8" } });
  });

  // Consumer-owned routes (login, logout, ...) - mounted before auth so they're reachable.
  config.configure?.(app);

  if (config.static) {
    app.use("/*", serveStatic({ root: config.static }));
  }

  // Resolve the account for every model-facing request, and gate it.
  app.use("/*", async (c, next) => {
    const tenant = config.identify ? await config.identify(c) : { account: SINGLE };
    if (!tenant) {
      return config.loginPath ? c.redirect(config.loginPath) : c.text("Unauthorized", 401);
    }
    c.set("store", storeFor(tenant.account));
    c.set("ctx", tenant.context);
    c.set("account", tenant.account);
    await next();
  });

  app.post("/__hallu/action", (c) => action(c, config, backend));
  if (config.pageChat) app.post("/__hallu/revise", (c) => revise(c, config, backend));
  app.get("/*", (c) => renderPagePath(c, config, backend));

  return app;
}

// --- full page load ---------------------------------------------------------

async function renderPagePath(c: any, config: HalluConfig, backend: Backend) {
  const store = c.get("store") as Store;
  const context = c.get("ctx") as string | undefined;
  const account = c.get("account") as string;
  const reqPath = c.req.path;
  if (isAssetProbe(reqPath)) return c.body("", 404);
  info(`→ GET ${reqPath} (account ${account})`);
  if (config.routes && !routeAllowed(reqPath, config.routes)) {
    info(`page ${reqPath}: blocked, not in routes`);
    c.status(404);
    c.header("content-type", "text/html; charset=utf-8");
    return c.body(page(config, store.chrome ?? "", NOT_FOUND_BODY));
  }

  const { path, fresh } = normalize(pathWithQuery(c));
  if (fresh) {
    store.cache.clearAll();
    store.chrome = undefined; // regenerate the nav too
  }

  // A full browser GET returns the complete page in one body (no incremental paint on load). Only
  // streaming POST actions stream. Render fully, then send.
  let conn: Conn | undefined;
  const getConn = async () => (conn ??= await backend.acquire(account));
  try {
    if (config.navLinks && store.chrome === undefined) {
      store.chrome = await renderChrome(config, await getConn());
    }
    const started = Date.now();
    const { html, source, mutated, writes } = await renderOrServe(config, store.cache, getConn, path, context);
    if (source !== "cache") deferAfterWrite(backend, account, config, writes);
    info(
      source === "cache"
        ? `page ${path}: cache hit`
        : `page ${path}: rendered (${source}) in ${Date.now() - started}ms, ${html.length} bytes${invalidationNote(config, mutated)}`,
    );
    c.header("content-type", "text/html; charset=utf-8");
    return c.body(page(config, store.chrome ?? "", html));
  } finally {
    conn?.release();
  }
}

// --- page-chat revise -------------------------------------------------------

// The page-chat panel posts an instruction here. We save it to hallu_pages (keyed by a glob), then
// re-render the page so the edit applies immediately, and return the new body as a hallu-root update.
async function revise(c: any, config: HalluConfig, backend: Backend) {
  const { cache } = c.get("store") as Store;
  const context = c.get("ctx") as string | undefined;
  const account = c.get("account") as string;
  const { page, instruction } = await c.req.json();
  const text = String(instruction ?? "").trim();
  const { path: pagePath } = normalize(page);
  if (!text) return c.body("");
  // Scope the edit the same way the cache keys this page: per shape under cacheTemplate, else this path.
  const glob = config.cacheTemplate ? templateKey(pagePath, config.routes) : pagePath;
  info(`→ revise ${pagePath} (account ${account}): ${text}`);

  let conn: Conn | undefined;
  try {
    conn = await backend.acquire(account);
    await conn.savePageEdit(glob, text);
    // Drop only the pages this edit's glob covers, so they re-render with it; leave the rest cached.
    cache.invalidateWhere((p) => patternToRegex(glob).test(p.split("?")[0]));
    const started = Date.now();
    const directives = await loadDirectives(conn, pagePath, config);
    const { html } = await renderPage(config, conn, pagePath, context, undefined, directives);
    if (html) cache.put(config.cacheTemplate ? templateKey(pagePath, config.routes) : pagePath, html);
    info(`revise ${pagePath}: re-rendered in ${Date.now() - started}ms, ${directives.length} edit(s) applied`);
    c.header("content-type", "text/html; charset=utf-8");
    return c.body(serializeUpdate(rootUpdate(html)));
  } finally {
    conn?.release();
  }
}

// --- action (SPA link/form) -------------------------------------------------

async function action(c: any, config: HalluConfig, backend: Backend) {
  const { cache } = c.get("store") as Store;
  const context = c.get("ctx") as string | undefined;
  const account = c.get("account") as string;
  const { page, method, action, params } = await c.req.json();
  const { path: pagePath } = normalize(page);
  const { path: actionPath, fresh } = normalize(action);
  info(`→ ${method} ${actionPath} (account ${account})`);
  if (fresh) cache.clearAll();

  c.header("content-type", "text/html; charset=utf-8");
  return stream(c, async (s) => {
    // Updates go over the wire as raw HTML <hallu-update> blocks, not JSON.
    const write = (updates: Update[]) => s.write(updates.map(serializeUpdate).join(""));

    let conn: Conn | undefined;
    const getConn = async () => (conn ??= await backend.acquire(account));
    try {
      // A GET (link click or GET form) is a navigation = a page render. Fold any form params
      // into the path so the model sees them (e.g. /search?q=foo), then render raw HTML and swap
      // it in; the target is always hallu-root. Cached pages skip the model entirely.
      if (method === "GET") {
        if (config.routes && !routeAllowed(actionPath.split("?")[0], config.routes)) {
          info(`action GET ${actionPath}: blocked, not in routes`);
          await write([rootUpdate(NOT_FOUND_BODY)]);
          return;
        }
        const target = mergeParams(actionPath, params);
        const started = Date.now();
        const { html, source, mutated, writes } = await renderOrServe(config, cache, getConn, target, context);
        if (source !== "cache") deferAfterWrite(backend, account, config, writes);
        info(
          source === "cache"
            ? `action GET ${target}: cache hit, swapping without model`
            : `action GET ${target}: rendered (${source}) in ${Date.now() - started}ms${invalidationNote(config, mutated)}`,
        );
        await write([rootUpdate(html)]);
        return;
      }

      // Only POST form submissions reach here (GET navigations rendered above).
      const dom = cache.get(pagePath) ?? null;
      const started = Date.now();

      // With streamResponses, stream the action: <hallu-update> blocks and `stream` deltas reach the
      // client as the model produces them. Parse the final blocks afterward for the cache.
      if (config.streamResponses) {
        const as = handleActionStream(config, await getConn(), { page: pagePath, dom, method, action: actionPath, params }, context);
        for await (const frame of as.frames) await s.write(frame);
        const { updates, mutated, writes } = await as.finish();
        if (!config.cacheTemplate) {
          const newContent = nextContent(dom, updates);
          if (newContent !== null) cache.put(pagePath, newContent);
          if (mutated) invalidateAfterWrite(cache, pagePath, config);
        }
        deferAfterWrite(backend, account, config, writes);
        invalidateSchemaChange(cache, writes); // drop only the altered table's cached pages and templates
        if (editsChanged(config, writes)) await invalidateEditedPages(cache, await getConn());
        info(
          `action ${method} ${actionPath}: streamed in ${Date.now() - started}ms, ` +
            `updating [${updates.map((u) => u.target).join(", ")}]${invalidationNote(config, mutated)}`,
        );
        return;
      }

      const { updates, mutated, writes } = await handleAction(config, await getConn(), { page: pagePath, dom, method, action: actionPath, params }, context);

      // A form patches the page it was on. Outside template mode, re-derive that page's cached
      // content from the updates. In template mode the cache holds the pinned template, so leave it
      // alone - the next render rebuilds the page from live data through that template.
      if (!config.cacheTemplate) {
        const newContent = nextContent(dom, updates);
        if (newContent !== null) cache.put(pagePath, newContent);
        if (mutated) invalidateAfterWrite(cache, pagePath, config);
      }
      deferAfterWrite(backend, account, config, writes);
      invalidateSchemaChange(cache, writes); // drop only the altered table's cached pages and templates
      if (editsChanged(config, writes)) await invalidateEditedPages(cache, await getConn());

      info(
        `action ${method} ${actionPath}: done in ${Date.now() - started}ms, ` +
          `updating [${updates.map((u) => u.target).join(", ")}]${invalidationNote(config, mutated)}`,
      );
      await write(updates);
    } finally {
      conn?.release();
    }
  });
}

// After a write, the just-rendered `current` page is already re-cached fresh. Other cached
// pages may now be stale. Without `invalidateOnWrite` we can't know which, so drop them all.
// With it, drop only `current` plus pages matching the globs (aggregates like "/", "/search"),
// keeping unrelated detail pages cached.
function invalidateAfterWrite(cache: PageCache, current: string, config: HalluConfig): void {
  const globs = config.invalidateOnWrite;
  if (!globs) {
    cache.invalidateExcept(current);
    return;
  }
  cache.invalidateWhere((p) => p !== current && globs.some((g) => patternToRegex(g).test(p.split("?")[0])));
}

type Rendered = { html: string; source: "cache" | "template" | "scratch"; mutated: boolean; writes: SqlEvent[] };

// Produce the HTML body for a GET of `path`. Normal mode: serve cached HTML if present, otherwise
// render and cache (invalidating other pages on a write). Template mode (`cacheTemplate`): always
// render through the model against live data, guided by the per-path template, and pin the first
// render as that template - so structure stays stable, data is never stale, nothing needs dropping.
async function renderOrServe(
  config: HalluConfig,
  cache: PageCache,
  getConn: () => Promise<Conn>,
  path: string,
  context: string | undefined,
): Promise<Rendered> {
  if (config.cacheTemplate) {
    // Key by route pattern, not literal path, so every page sharing a shape reuses one template
    // (e.g. all `/wiki/*` articles). The first matching page pins it; the rest render against it.
    const key = templateKey(path, config.routes);
    const template = cache.get(key); // undefined after a `fresh` clear or for a shape's first render
    const conn = await getConn();
    const directives = await loadDirectives(conn, path, config);
    const { html, mutated, writes } = await renderPage(config, conn, path, context, template, directives);
    if (template === undefined && html) cache.put(key, html); // pin the first render as the template
    return { html, source: template === undefined ? "scratch" : "template", mutated, writes };
  }
  const cached = cache.get(path);
  if (cached !== undefined) return { html: cached, source: "cache", mutated: false, writes: [] };
  const conn = await getConn();
  const directives = await loadDirectives(conn, path, config);
  const { html, mutated, writes } = await renderPage(config, conn, path, context, undefined, directives);
  if (html) cache.put(path, html); // never cache an empty render - let the next visit retry
  if (mutated) invalidateAfterWrite(cache, path, config);
  return { html, source: "scratch", mutated, writes };
}

// Page-chat edits whose glob matches this path, in save order - re-applied on every render so they stick.
async function loadDirectives(conn: Conn, path: string, config: HalluConfig): Promise<string[]> {
  if (!config.pageChat) return [];
  try {
    const rows = (await conn.readRows("SELECT glob, instruction FROM hallu_pages ORDER BY id")) as {
      glob: string;
      instruction: string;
    }[];
    const pathname = path.split("?")[0];
    return rows.filter((r) => patternToRegex(r.glob).test(pathname)).map((r) => r.instruction);
  } catch {
    return []; // table not present yet
  }
}

// A column change (addFields ALTER) makes only the affected table's index/record pages stale. Map the
// altered table to the first path segment so just that table's cached pages and templates are dropped.
const ALTER_TABLE = /^\s*alter\s+table\s+["'`]?(\w+)["'`]?/i;
function firstSegment(path: string): string {
  return path.split("?")[0].split("/").filter(Boolean)[0] ?? "";
}
function invalidateSchemaChange(cache: PageCache, writes: SqlEvent[]): void {
  const tables = writes
    .map((w) => w.query.match(ALTER_TABLE)?.[1]?.toLowerCase())
    .filter((t): t is string => !!t);
  if (tables.length) cache.invalidateWhere((p) => tables.includes(firstSegment(p)));
}

// A write to hallu_pages (a saved/edited page-chat instruction) changes which edits apply, so the cached
// pages those edits cover must re-render. Drop only the entries matching a current glob.
function editsChanged(config: HalluConfig, writes: SqlEvent[]): boolean {
  return !!config.pageChat && writes.some((w) => /\bhallu_pages\b/i.test(w.query));
}
async function invalidateEditedPages(cache: PageCache, conn: Conn): Promise<void> {
  try {
    const rows = (await conn.readRows("SELECT DISTINCT glob FROM hallu_pages")) as { glob: string }[];
    const regexes = rows.map((r) => patternToRegex(r.glob));
    if (regexes.length) cache.invalidateWhere((p) => regexes.some((re) => re.test(p.split("?")[0])));
  } catch {
    // table absent or unreadable - nothing to invalidate
  }
}

// Describes, for the log, what a write did to the cache.
function invalidationNote(config: HalluConfig, mutated: boolean): string {
  if (!mutated) return "";
  if (config.cacheTemplate) return ", db changed"; // re-renders live each request; nothing to invalidate
  if (config.invalidateOnWrite) return `, db changed (invalidated ${config.invalidateOnWrite.join(", ")})`;
  return ", db changed (all other pages invalidated)";
}

function nextContent(dom: string | null, updates: Update[]): string | null {
  const root = updates.find((u) => u.target === "hallu-root");
  if (root) return innerOf(root.html, "hallu-root") ?? root.html;
  return dom ? applyUpdates(dom, updates) : null;
}

function rootUpdate(content: string): Update {
  return { target: "hallu-root", html: `<main id="hallu-root">${content}</main>` };
}

// --- path helpers -----------------------------------------------------------

const NOT_FOUND_BODY = `<p>Page not found.</p><p><a href="/">Home</a></p>`;

// Fold a GET form's params into the path so the model sees them (e.g. /search + {q} -> /search?q=...).
function mergeParams(path: string, params: Record<string, unknown>): string {
  const keys = Object.keys(params ?? {});
  if (keys.length === 0) return path;
  const url = new URL(path, "http://x");
  for (const k of keys) {
    const v = params[k];
    if (v != null && v !== "") url.searchParams.set(k, String(v));
  }
  const qs = url.searchParams.toString();
  return url.pathname + (qs ? `?${qs}` : "");
}

// Whitelist match. Glob: `*` matches one path segment, `**` matches any (incl. slashes).
function routeAllowed(pathname: string, patterns: string[]): boolean {
  return patterns.some((p) => patternToRegex(p).test(pathname));
}

// The cache key for a path's template: the first `routes` pattern it matches (so `/wiki/foo` and
// `/wiki/bar` share the `/wiki/*` template). Falls back to the literal path when no routes are set.
function templateKey(path: string, routes: string[] | undefined): string {
  if (!routes) return path;
  const pathname = path.split("?")[0];
  return routes.find((p) => patternToRegex(p).test(pathname)) ?? path;
}
function patternToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const body = escaped
    .split("**")
    .map((seg) => seg.replace(/\*/g, "[^/]+"))
    .join(".*");
  return new RegExp(`^${body}$`);
}

// Browser-initiated probes (icons, manifests, .well-known) must never reach the model. Match known
// asset extensions only - NOT "any path segment with a dot", which would 404 legitimate content slugs
// like /users/jane.doe or /products/3.5-inch.
const ASSET_EXT = /\.(ico|png|jpe?g|gif|svg|webp|avif|bmp|css|js|mjs|cjs|map|wasm|woff2?|ttf|otf|eot|txt|xml|webmanifest|pdf)$/i;
function isAssetProbe(path: string): boolean {
  if (path.startsWith("/.well-known/")) return true;
  return ASSET_EXT.test(path);
}

function pathWithQuery(c: any): string {
  const url = new URL(c.req.url);
  return url.pathname + url.search;
}

// Strips the framework-level fresh=true param; returns { path, fresh }.
function normalize(pathWithQuery: string): { path: string; fresh: boolean } {
  const url = new URL(pathWithQuery, "http://x");
  const fresh = url.searchParams.get("fresh") === "true";
  url.searchParams.delete("fresh");
  const qs = url.searchParams.toString();
  return { path: url.pathname + (qs ? `?${qs}` : ""), fresh };
}
