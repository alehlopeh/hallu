# Hallu: this web app does not exist

<p>
  <img src="demo/hallupedia.gif" alt="Hallupedia demo" width="48%" />
  &nbsp;
  <img src="demo/chatty.gif" alt="Chatty demo" width="48%" />
</p>

Hallu is a web framework where an LLM hallucinates your entire app. Build any app with zero application code.

Every request routes to a model with a SQL tool and instructions to return html. The model is the controller, the ORM, and the template engine.

Sure it's slow, it burns tokens, it depends on an LLM writing SQL against your database from user input. So what?

Point one of the examples to Haiku and watch a working app assemble itself, request by request, from a prompt.

Don't just have Claude write your app. Have Claude **be** your app. Is this the last framework ever? Who knows.

Built on Bun + Hono. SQLite by default, Postgres optional. Bring your own model.

## How it works

- **One catch-all route.** `GET /*` asks the model for the page body. A client runtime
  intercepts form submits and POSTs them to `/__hallu/action`.
- **One tool.** The model reads and writes the database through a single `sql` tool in a
  loop.
- **Wire format.** Actions stream back `<hallu-update target="id">...</hallu-update>` blocks.
  The client swaps each region in by id. It feels like an SPA.
- **Caching.** Rendered pages are cached per path so warm loads skip the model. A DB write
  invalidates affected pages (coarse by default, or scoped with a glob).
- **Two schema modes.** Fixed (`tables` is the whole schema) or `autoSchema` (the model
  creates tables on the fly for paths it hasn't seen).

### autoSchema mode
Describe your domain in plain language. The schema grows as you browse. Visit a path for the
first time and the model will design a table, create it, and render the page to html. Add
`/new` to the path, and the model will generate a form. Submit the form and the model will
insert the record and render the page. Add `/delete` to the path, and the model will present
you with an "Are you sure?" form and then delete the record, as requested.

### tables mode
Pin the schema yourself. Declare your tables in the config and the framework creates them
on boot. The model reads and writes only within them and never runs DDL, so the shape of
your data is fixed and known. Everything else is the same: the model still writes the
`SELECT` for a page and the `INSERT` for a form, and renders the result.

## Examples

Each of these apps is just a `hallu.config.ts`, a markdown description, and a stylesheet.

- **Hallupedia.** A "real world" encyclopedia for exploring a model's knowledge graph.
- **Slop Overflow.** A Q&A site for programmers, running on Postgres with autoSchema.
- **Chatty.** A ChatGPT-style chat app.
- **Autocrud.** As much CRUD as you can shove in a URL path.


## Get started

```bash
bunx hallujs generate myapp   # defaults: Anthropic + SQLite
cd myapp && bun install
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env
bun dev
```

## Caveats

- **It's slow.** A page is a model call, sometimes several. Pages take ~2s to load on Haiku.
  It's a website powered by a tool calling LLM though. What'd you expect?
- **It costs tokens.** Every cold request is tokens. There's a cache, so it's not insane,
  but nobody is running their SaaS on this in 2026. (2030 is a different conversation.)
- **It's non-deterministic.** The same URL renders differently every cold load and cache invalidation.
- **The security model isn't perfect.** The framework passes untrusted input to an LLM and asks it
  to write arbitrary SQL. That's dangerous. There's a script in the repo that tests common
  SQL-injection techniques. But yeah, it's an LLM hallucinating SQL. Don't use this for anything important.

## Develop

```bash
bun install
bun test        # offline: runs against a stubbed model, fast and deterministic
```

## Configuration

`hallu.config.ts` default-exports `defineConfig({...})`. Required: `name`, `description`, `model`.

| Option | Type | Default | |
| --- | --- | --- | --- |
| `name` | `string` |  | App name; document `<title>`. |
| `description` | `string` |  | The domain, data, and rules in prose. |
| `model` | `LanguageModel` |  | Any AI SDK model, e.g. `anthropic("claude-opus-4-8")`. |
| `tables` | `Record<string, Record<string, string>>` | `{}` | Schema as `{ table: { column: "<sql type>" } }`, created on boot. |
| `autoSchema` | `boolean` | `false` | Let the model `CREATE` tables/FKs on the fly; else DDL is forbidden. |
| `addFields` | `boolean` | `false` | "Add field" control that runs `ALTER TABLE ADD COLUMN`. |
| `design` | `string` |  | CSS guidance for the model (class names, Tailwind, ...). |
| `head` | `string` |  | Raw HTML injected into `<head>`. |
| `static` | `string` |  | Directory served at web root. |
| `navLinks` | `boolean` | `false` | Have the model render a nav menu of related links. |
| `indexPrompt` | `string` |  | Extra render instructions for `/` only. |
| `routes` | `string[]` | allow all | Allowed path globs (`*`/`**`); non-matches 404 before the model. |
| `cacheHtml` | `boolean` | `true` | Serve cached page HTML; false re-renders every request. |
| `cacheTemplate` | `boolean` | `false` | Cache a per-shape template, re-render against live data. Beats `cacheHtml`. |
| `invalidateOnWrite` | `string[]` | drop all | Globs of pages to drop on write; else every page drops. |
| `identify` | `(c) => Tenant \| null` | single-tenant | Resolve the account for a request; DB + cache key per account. |
| `loginPath` | `string` | `401` | Redirect when `identify` returns null. |
| `configure` | `(app: Hono) => void` |  | Mount your own routes before the catch-all. |
| `temperature` | `number` | `0.35` | Sampling temperature. |
| `port` | `number` | env `PORT` / `7777` | Listen port. |
| `logLevel` | `"debug" \| "info" \| "silent"` | `"debug"` | `debug` logs every SQL statement. |
| `onSql` | `(e: SqlEvent) => void` |  | Called after each `sql` execution. |
| `database` | sqlite or postgres | sqlite | `{ driver: "sqlite", path?, dir? }` or `{ driver: "postgres", url, schema? }`. |
| `seed` | `(db) => void` |  | Run once when a DB/schema is first created. |
| `afterWrite` | `(db, events) => void` |  | Maintain derived data off the critical path after a write. |

`Tenant` is `{ account, context? }`; `SqlEvent` is `{ query, ok, mutated, error? }`. SQLite `path` defaults to `./hallu.db` (per-account files under `dir`, `./data`); Postgres `schema` defaults to `public`.

## License

MIT
