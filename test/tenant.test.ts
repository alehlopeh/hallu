// Per-account isolation: the gate denies unidentified requests, and each account
// gets its own SQLite file. (Uses a trivial fake model that returns HTML directly.)

import { test, expect, afterAll } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { MockLanguageModelV3 } from "ai/test";
import { createApp } from "../src/server.ts";
import { defineConfig } from "../src/index.ts";

const dbDir = `/tmp/hallu-tenant-${process.pid}`;

function fakeModel() {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: "text" as const, text: '<p id="x">hi</p>' }],
      finishReason: { unified: "stop" as const, raw: undefined },
      usage: { inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 0, text: 0, reasoning: 0 } },
      warnings: [],
    }),
  });
}

afterAll(() => {
  rmSync(dbDir, { recursive: true, force: true });
});

function app(opts: { loginPath?: string } = {}) {
  return createApp(
    defineConfig({
      name: "T",
      description: "t",
      tables: { lists: { id: "integer primary key autoincrement", name: "text" } },
      database: { driver: "sqlite", dir: dbDir },
      model: fakeModel(),
      loginPath: opts.loginPath,
      identify: (c) => {
        const account = c.req.header("x-account");
        return account ? { account, context: `account ${account}` } : null;
      },
    }),
  );
}

test("unidentified request is denied with 401 when no loginPath", async () => {
  const res = await app().fetch(new Request("http://x/"));
  expect(res.status).toBe(401);
});

test("unidentified request redirects to loginPath when set", async () => {
  const res = await app({ loginPath: "/login" }).fetch(new Request("http://x/"));
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("/login");
});

test("each account gets its own db file", async () => {
  const a = app();
  await a.fetch(new Request("http://x/", { headers: { "x-account": "acme" } }));
  await a.fetch(new Request("http://x/", { headers: { "x-account": "globex" } }));
  expect(existsSync(`${dbDir}/acme.db`)).toBe(true);
  expect(existsSync(`${dbDir}/globex.db`)).toBe(true);
});

test("account keys are sanitized so they can't escape the db dir", async () => {
  await app().fetch(new Request("http://x/", { headers: { "x-account": "../../etc/evil" } }));
  expect(existsSync(`${dbDir}/______etc_evil.db`)).toBe(true); // "../../etc/evil" → dots+slashes all become _
  expect(existsSync("/tmp/etc/evil.db")).toBe(false); // never escaped dbDir
});
