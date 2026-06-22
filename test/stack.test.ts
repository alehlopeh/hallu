// Exercises the whole request path against a FAKE model, so the tool loop,
// SQLite writes, the <hallu-update> wire format, cache, and DOM patching are all
// real - only the model is stubbed (an AI SDK MockLanguageModelV3).

import { test, expect } from "bun:test";
import { MockLanguageModelV3 } from "ai/test";
import { createApp } from "../src/server.ts";
import { defineConfig, type HalluConfig } from "../src/index.ts";
import { parseUpdateBlocks } from "../src/dom.ts";

const USAGE = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};

// First turn returns a sql tool call; once a tool result is present, returns the final
// answer - HTML body for page mode, <hallu-update> blocks for action mode.
function fakeModel() {
  return new MockLanguageModelV3({
    doGenerate: async ({ prompt }) => {
      const system = prompt.find((m) => m.role === "system")?.content ?? "";
      const isAction = typeof system === "string" && system.includes("action mode");
      const hasToolResult = prompt.some((m) => m.role === "tool");

      if (!hasToolResult) {
        const query = isAction ? "INSERT INTO lists (name) VALUES ('x')" : "SELECT name FROM lists";
        return {
          content: [{ type: "tool-call" as const, toolCallId: "call-1", toolName: "sql", input: JSON.stringify({ query }) }],
          finishReason: { unified: "tool-calls" as const, raw: undefined },
          usage: USAGE,
          warnings: [],
        };
      }
      const text = isAction
        ? '<hallu-update target="task-list"><ul id="task-list"><li>real</li></ul></hallu-update>'
        : '<h1 class="page-title">Tasks</h1><ul id="task-list"><li>Try out Hallu</li></ul>';
      return {
        content: [{ type: "text" as const, text }],
        finishReason: { unified: "stop" as const, raw: undefined },
        usage: USAGE,
        warnings: [],
      };
    },
  });
}

function app(extra: Partial<HalluConfig> = {}) {
  return createApp(
    defineConfig({
      name: "Tasks",
      description: "test app",
      tables: {
        lists: { id: "integer primary key autoincrement", name: "text not null" },
        tasks: { id: "integer primary key autoincrement", list_id: "integer not null", title: "text not null", done: "integer not null default 0" },
      },
      static: "examples/salesfarce/public",
      head: '<link rel="stylesheet" href="/app.css">',
      database: { driver: "sqlite", path: ":memory:" },
      model: fakeModel(),
      seed: (db) => db.run("INSERT INTO lists (name) VALUES ('Today')"),
      ...extra,
    }),
  );
}

test("serves the client runtime", async () => {
  const res = await app().fetch(new Request("http://x/__hallu/client.js"));
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("javascript");
  expect(await res.text()).toContain("addEventListener");
});

test("serves the app's own static CSS", async () => {
  const res = await app().fetch(new Request("http://x/app.css"));
  expect(res.status).toBe(200);
  expect(await res.text()).toContain(".btn");
});

test("asset probes 404 without calling the model", async () => {
  const res = await app().fetch(new Request("http://x/favicon.ico"));
  expect(res.status).toBe(404);
});

test("renders a page through the model tool loop, wrapped in the page", async () => {
  const res = await app().fetch(new Request("http://x/"));
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain("<!doctype html>");
  expect(html).toContain('id="hallu-root"');
  expect(html).toContain("Try out Hallu"); // model output, inlined
  expect(html).toContain('href="/app.css"'); // injected head
});

test("a form action runs the write and returns updates as hallu-update blocks", async () => {
  const a = app();
  await a.fetch(new Request("http://x/")); // prime the page cache

  const res = await a.fetch(
    new Request("http://x/__hallu/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ page: "/", method: "POST", action: "/", params: { title: "x" } }),
    }),
  );
  expect(res.status).toBe(200);
  const updates = parseUpdateBlocks(await res.text());
  expect(updates).toHaveLength(1);
  expect(updates[0].target).toBe("task-list");
  expect(updates[0].html).toContain("real");
});

test("routes whitelist blocks disallowed paths before the model", async () => {
  const a = app({ routes: ["/", "/lists", "/lists/*"] });
  expect((await a.fetch(new Request("http://x/lists"))).status).toBe(200); // allowed
  expect((await a.fetch(new Request("http://x/lists/5"))).status).toBe(200); // wildcard

  const blocked = await a.fetch(new Request("http://x/secret"));
  expect(blocked.status).toBe(404);
  expect(await blocked.text()).toContain("Page not found"); // static, model never called
});

test("afterWrite fires once after a mutating request with a working db handle", async () => {
  const writes: string[] = [];
  let listCount = -1;
  const a = app({
    afterWrite: (db, events) => {
      for (const e of events) writes.push(e.query);
      listCount = (db.query("SELECT count(*) n FROM lists").get() as { n: number }).n;
    },
  });

  await a.fetch(new Request("http://x/")); // page render is read-only → no afterWrite
  expect(writes).toHaveLength(0);

  const res = await a.fetch(
    new Request("http://x/__hallu/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ page: "/", method: "POST", action: "/", params: { title: "x" } }),
    }),
  );
  await res.text(); // drain the streamed action so handleAction runs
  await Bun.sleep(20); // afterWrite is deferred (fires once, after the response)

  expect(writes.some((q) => /INSERT INTO lists/i.test(q))).toBe(true);
  expect(listCount).toBeGreaterThan(0); // the Database handle worked inside the hook
});

test("invalidateOnWrite drops matching pages but keeps unrelated cached pages", async () => {
  let renders = 0; // each page render runs one SELECT; a cache hit runs none
  const a = app({
    invalidateOnWrite: ["/"],
    onSql: (e) => { if (e.ok && !e.mutated) renders++; },
  });
  const drain = (body: unknown) =>
    a.fetch(new Request("http://x/__hallu/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).then((r) => r.text());

  await a.fetch(new Request("http://x/")); // render + cache "/"
  await a.fetch(new Request("http://x/lists/1")); // render + cache "/lists/1"
  expect(renders).toBe(2);

  // A write while on /lists/1: "/" matches the glob and is dropped; "/lists/1" is kept.
  await drain({ page: "/lists/1", method: "POST", action: "/lists", params: { name: "x" } });

  await drain({ page: "/lists/1", method: "GET", action: "/", params: {} }); // "/" was dropped → re-renders
  expect(renders).toBe(3);

  await drain({ page: "/", method: "GET", action: "/lists/1", params: {} }); // "/lists/1" survived → cache hit
  expect(renders).toBe(3);
});

test("SPA navigation to a cached page swaps without calling the model", async () => {
  const a = app();
  await a.fetch(new Request("http://x/")); // cache "/"
  const res = await a.fetch(
    new Request("http://x/__hallu/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ page: "/", method: "GET", action: "/", params: {} }),
    }),
  );
  const updates = parseUpdateBlocks(await res.text());
  expect(updates).toHaveLength(1);
  expect(updates[0].target).toBe("hallu-root");
});
