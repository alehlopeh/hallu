#!/usr/bin/env bun
// `hallu dev` / `hallu start` serve the project's hallu.config.ts.
// `hallu generate <dir>` scaffolds a new app.

import { resolve, join, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { createApp } from "./server.ts";
import type { HalluConfig } from "./index.ts";

const command = process.argv[2] ?? "dev";

if (command === "generate") {
  await generate(process.argv.slice(3));
  process.exit(0);
}

if (command !== "dev" && command !== "start") {
  console.error(`hallu: unknown command "${command}". Usage: hallu [dev|start|generate <dir>]`);
  process.exit(1);
}

// `hallu dev --hot`: re-exec under Bun's hot reloader so edits to config and source reload in-process
// (Bun.serve is reused, connections aren't dropped). The HALLU_HOT guard prevents an exec loop.
if (command === "dev" && process.argv.includes("--hot") && !process.env.HALLU_HOT) {
  const child = Bun.spawn(["bun", "--hot", import.meta.path, "dev"], {
    env: { ...process.env, HALLU_HOT: "1" },
    stdio: ["inherit", "inherit", "inherit"],
  });
  process.exit(await child.exited);
}

const configPath = await findConfig();
if (!configPath) {
  console.error("hallu: no hallu.config.ts (or .js) found in", process.cwd());
  process.exit(1);
}

const mod = (await import(pathToFileURL(configPath).href)) as { default?: HalluConfig };
const config = mod.default;
if (!config || typeof config !== "object") {
  console.error(`hallu: ${configPath} must default-export a defineConfig({...}) object`);
  process.exit(1);
}

if (!config.model) {
  console.error('hallu: no model. Set `model` in hallu.config to an AI SDK LanguageModel, e.g. anthropic("claude-opus-4-8").');
  process.exit(1);
}
const modelId = typeof config.model === "string" ? config.model : config.model.modelId;

const port = config.port ?? (process.env.PORT ? Number(process.env.PORT) : 7777);
const app = createApp(config);

// 255 is Bun's max idleTimeout; the per-call model timeout (CALL_TIMEOUT_MS in llm.ts) is held under it
// so a slow buffered render aborts cleanly rather than having the socket dropped out from under it.
Bun.serve({ port, fetch: app.fetch, idleTimeout: 255 });

const dbLine = describeDb();

const banner = await Bun.file(new URL("./banner.txt", import.meta.url)).text();
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

console.log(`\n\x1b[38;5;39m${banner}\x1b[0m`);
console.log(`  ${config.name}`);
console.log(dim(`  ▸ http://localhost:${port}`));
console.log(dim(`  ▸ model ${modelId}`));
console.log(dim(`  ▸ db ${dbLine}`) + "\n");

function describeDb(): string {
  if (config!.database?.driver === "postgres") {
    const loc = config!.database.url.replace(/\/\/[^@/]*@/, "//"); // drop credentials from the banner
    return config!.identify ? `postgres ${loc} (schema per account)` : `postgres ${loc}`;
  }
  return config!.identify
    ? `${config!.database?.dir ?? "./data"}/<account>.db (per account)`
    : (config!.database?.path ?? "./hallu.db");
}

async function findConfig(): Promise<string | null> {
  for (const name of ["hallu.config.ts", "hallu.config.js"]) {
    const p = resolve(process.cwd(), name);
    if (await Bun.file(p).exists()) return p;
  }
  return null;
}

// `hallu generate <dir> [--postgres] [--anthropic|--ollama|--openai]` - scaffold a starter app.
async function generate(argv: string[]): Promise<void> {
  const usage = "Usage: hallu generate <dir> [--postgres] [--anthropic|--ollama|--openai]";
  let dir: string | undefined;
  let provider: "anthropic" | "openai" | "ollama" = "anthropic";
  let providerFlag: string | undefined;
  let postgres = false;
  for (const a of argv) {
    if (a === "--postgres") postgres = true;
    else if (a === "--anthropic" || a === "--openai" || a === "--ollama") {
      if (providerFlag && providerFlag !== a) {
        console.error(`hallu: conflicting provider flags ${providerFlag} and ${a}. ${usage}`);
        process.exit(1);
      }
      providerFlag = a;
      provider = a.slice(2) as typeof provider;
    } else if (a.startsWith("-")) {
      console.error(`hallu: unknown flag "${a}". ${usage}`);
      process.exit(1);
    } else if (!dir) dir = a;
    else {
      console.error(`hallu: unexpected argument "${a}". ${usage}`);
      process.exit(1);
    }
  }

  const target = resolve(process.cwd(), dir ?? ".");
  const base = basename(target) || "app";
  const appName = base.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const dbName = base.toLowerCase().replace(/[^a-z0-9_]+/g, "_");

  const configPath = join(target, "hallu.config.ts");
  if (await Bun.file(configPath).exists()) {
    console.error(`hallu: ${configPath} already exists - not overwriting.`);
    process.exit(1);
  }

  const PROVIDERS = {
    anthropic: { pkg: "@ai-sdk/anthropic", import: `import { anthropic } from "@ai-sdk/anthropic";`, preamble: "\n", model: `anthropic("claude-opus-4-8")`, env: "ANTHROPIC_API_KEY" as string | null },
    openai: { pkg: "@ai-sdk/openai", import: `import { openai } from "@ai-sdk/openai";`, preamble: "\n", model: `openai("gpt-4o")`, env: "OPENAI_API_KEY" as string | null },
    ollama: { pkg: "@ai-sdk/openai-compatible", import: `import { createOpenAICompatible } from "@ai-sdk/openai-compatible";`, preamble: `\nconst ollama = createOpenAICompatible({ name: "ollama", baseURL: "http://localhost:11434/v1" });\n\n`, model: `ollama("llama3.2")`, env: null as string | null },
  };
  const p = PROVIDERS[provider];

  const idCol = postgres ? "bigint generated always as identity primary key" : "integer primary key autoincrement";
  const createdCol = postgres ? "timestamptz not null default now()" : "text not null default current_timestamp";
  const databaseLine = postgres ? `  database: { driver: "postgres", url: "postgres://localhost:5432/${dbName}" },\n` : "";

  const configSource = `import { defineConfig } from "hallujs";
${p.import}
${p.preamble}export default defineConfig({
  name: "${appName}",
  model: ${p.model},
${databaseLine}  description: \`Describe your app: its purpose, its pages, and how its data relates.\`,
  tables: {
    items: {
      id: "${idCol}",
      title: "text not null",
      created_at: "${createdCol}",
    },
  },
  design: "Style with these classes (a stylesheet is already loaded): card, btn, btn-primary, list, list-item.",
  head: \`<link rel="stylesheet" href="/app.css">\`,
  static: "./public",
});
`;

  const appCss = `/* Your stylesheet. These class names match hallu.config.ts → design. */
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, sans-serif; color: #1a1a1a; background: #f6f6f4; line-height: 1.5; }
#hallu-root { max-width: 720px; margin: 0 auto; padding: 32px 20px; }
.card { background: #fff; border: 1px solid #e4e4e0; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
.list { list-style: none; padding: 0; margin: 0; }
.list-item { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 12px 14px;
  background: #fff; border: 1px solid #e4e4e0; border-radius: 10px; margin-bottom: 8px; text-decoration: none; color: inherit; }
.btn { display: inline-flex; align-items: center; gap: 6px; padding: 9px 14px; font: inherit; font-weight: 600;
  color: #1a1a1a; background: #fff; border: 1px solid #d9d9d4; border-radius: 9px; cursor: pointer; text-decoration: none; }
.btn-primary { background: #2563eb; border-color: #2563eb; color: #fff; }
`;

  const gitignore = "node_modules\n.env\nhallu.db*\ndata/\n";

  // Pin the generated app to this CLI's own published version so a fresh
  // `bun install` pulls the matching hallujs from npm.
  const { version } = (await Bun.file(resolve(import.meta.dir, "../package.json")).json()) as { version: string };
  const packageJson = JSON.stringify({
    name: dbName,
    type: "module",
    private: true,
    scripts: { dev: "hallu", start: "hallu start" },
    dependencies: { hallujs: `^${version}`, [p.pkg]: "latest" },
  }, null, 2) + "\n";

  await Bun.write(configPath, configSource);
  await Bun.write(join(target, "package.json"), packageJson);
  await Bun.write(join(target, "public/app.css"), appCss);
  await Bun.write(join(target, ".gitignore"), gitignore);

  const rel = dir ?? ".";
  const steps = [
    "",
    `Created ${rel}/`,
    "  hallu.config.ts",
    "  package.json",
    "  public/app.css",
    "  .gitignore",
    "",
    "Next:",
    rel === "." ? null : `  cd ${rel}`,
    "  bun install",
    p.env ? `  echo "${p.env}=..." > .env` : "  # start Ollama, then set the model id in hallu.config.ts",
    postgres ? "  # create the Postgres database and edit the url in hallu.config.ts" : null,
    "  bun dev",
    "",
  ].filter((l): l is string => l !== null);
  console.log(steps.join("\n"));
}
