// Postgres backend: schema-per-account provisioning, one-time seed, isolation, and
// real writes through the model tool loop - against a live Postgres. Gated on
// HALLU_PG_URL (a throwaway database); skipped when unset.
//
//   HALLU_PG_URL=postgres://localhost:5432/hallu_test bun test test/postgres.test.ts

import { test, expect, afterAll, beforeEach } from "bun:test";
import { SQL } from "bun";
import { MockLanguageModelV3 } from "ai/test";
import { createApp } from "../src/server.ts";
import { defineConfig, type HalluConfig } from "../src/index.ts";

const PG_URL = process.env.HALLU_PG_URL;
const it = test.skipIf(!PG_URL);

const USAGE = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};

// Same shape as the SQLite stack test: first turn calls sql, second returns the final answer.
function fakeModel() {
  return new MockLanguageModelV3({
    doGenerate: async ({ prompt }) => {
      const system = prompt.find((m) => m.role === "system")?.content ?? "";
      const isAction = typeof system === "string" && system.includes("action mode");
      const hasToolResult = prompt.some((m) => m.role === "tool");
      if (!hasToolResult) {
        const query = isAction ? "INSERT INTO lists (name) VALUES ('added')" : "SELECT name FROM lists";
        return {
          content: [{ type: "tool-call" as const, toolCallId: "c1", toolName: "sql", input: JSON.stringify({ query }) }],
          finishReason: { unified: "tool-calls" as const, raw: undefined },
          usage: USAGE,
          warnings: [],
        };
      }
      const text = isAction
        ? '<hallu-update target="list"><ul id="list"><li>ok</li></ul></hallu-update>'
        : '<h1 id="t">Tasks</h1>';
      return { content: [{ type: "text" as const, text }], finishReason: { unified: "stop" as const, raw: undefined }, usage: USAGE, warnings: [] };
    },
  });
}

const schemas = ["acme", "globex"];
const admin = PG_URL ? new SQL(PG_URL) : null;

async function dropSchemas() {
  if (!admin) return;
  for (const s of schemas) await admin.unsafe(`DROP SCHEMA IF EXISTS "${s}" CASCADE`);
}
beforeEach(dropSchemas);
afterAll(async () => {
  await dropSchemas();
  if (admin) await admin.end();
});

function app(extra: Partial<HalluConfig> = {}) {
  return createApp(
    defineConfig({
      name: "T",
      description: "test",
      tables: {
        lists: { id: "bigint generated always as identity primary key", name: "text not null" },
      },
      database: { driver: "postgres", url: PG_URL! },
      model: fakeModel(),
      seed: async (sql) => { await sql`INSERT INTO lists (name) VALUES ('Today')`; },
      identify: (c) => {
        const account = c.req.header("x-account");
        return account ? { account, context: `account ${account}` } : null;
      },
      ...extra,
    }),
  );
}

function count(schema: string): Promise<number> {
  return admin!.unsafe(`SELECT count(*)::int n FROM "${schema}".lists`).then((r: any) => r[0].n);
}

it("provisions a schema per account and seeds it exactly once", async () => {
  const a = app();
  await a.fetch(new Request("http://x/", { headers: { "x-account": "acme" } }));
  await a.fetch(new Request("http://x/", { headers: { "x-account": "acme" } })); // second hit must not re-seed
  await a.fetch(new Request("http://x/", { headers: { "x-account": "globex" } }));

  expect(await count("acme")).toBe(1); // seeded once despite two requests
  expect(await count("globex")).toBe(1);
});

it("writes land in the requesting account's schema only", async () => {
  const a = app();
  await a.fetch(new Request("http://x/", { headers: { "x-account": "acme" } })); // provision+seed
  await a.fetch(new Request("http://x/", { headers: { "x-account": "globex" } }));

  const res = await a.fetch(
    new Request("http://x/__hallu/action", {
      method: "POST",
      headers: { "content-type": "application/json", "x-account": "acme" },
      body: JSON.stringify({ page: "/", method: "POST", action: "/lists", params: { name: "x" } }),
    }),
  );
  await res.text(); // drain the streamed response so handleAction (and its INSERT) completes

  expect(await count("acme")).toBe(2); // seed + the insert
  expect(await count("globex")).toBe(1); // untouched
});
