import { defineConfig } from "hallujs";
import { anthropic } from "@ai-sdk/anthropic";
const description = `An infinite CRUD app. There is no fixed domain and NO schema to begin with - every section you visit
becomes a new kind of record, and the app designs its tables as it is used. It can become anything: a
CRM, an issue tracker, a recipe box, an inventory, a reading list. A path is a request to manage a
collection - visiting "/<thing>" means "let me manage a collection of <thing>s", so create whatever
table that needs, with sensible columns, the first time it is visited.

Make everything CRUD. Every kind of record supports the full set: list, create, view, edit, and
delete. Every list page has a form to add a record; every detail page can edit or delete it.

Always render EVERY column the table has - never show only a subset. The add form (and the edit form)
has one input per editable column, skipping only auto columns like \`id\` and \`created_at\`; the detail
page shows all of a record's fields; the list shows each record's meaningful columns. When a collection
is first visited and you design its table, render an input for every column you created.

Relate records with foreign keys. When one kind of record naturally belongs to or references another
(an order has a customer, a task belongs to a project, a contact works at a company), add a foreign
key column and let the user pick the related record from a dropdown of existing ones. Show the
relationship both ways: a record links to its parent, and a parent lists its children.

Always LINK, never just name a path. Every collection, record, and suggested path you mention is a real
clickable <a href> to its URL: a collection links to "/<collection>", a record to "/<collection>/:id".
This includes suggestions and empty states - when you invite the user to visit a path that does not
exist yet (for example /contacts or /tasks), render each one as a link to that path, not as plain text,
so a single click goes there and creates it. Never print a bare path the user cannot click.

The navigation bar ALWAYS includes a "Collections" link to "/collections".

Pages:
- The home page ("/") is a dashboard: list the kinds of records that exist (the tables) as links to
  "/<collection>" with their counts, and the most recently created records across all of them, each
  linking to its detail page.
- "/collections" is an overview that lists every record type (table) in the database with its count,
  each linking to "/<collection>".
- "/<collection>" lists records of that kind newest-first, with a form to add one. Foreign-key
  columns render as a dropdown of existing related records. Every collection index page also has a
  "Related" section: links to the other tables connected to this one by a foreign key (in BOTH
  directions - the tables it points to and the tables that point to it), AND a few suggested NEW
  related collections that don't exist yet but plausibly belong with this one (e.g. for /contacts:
  /companies, /deals, /notes). Render every one as a link to "/<collection>" so a click opens or
  creates it.
- "/<collection>/:id" shows one record with all its fields and any related records (its children),
  plus controls to edit and delete it.

The schema does not exist yet: create whatever tables a page needs the first time it is visited, with
sensible columns and foreign keys for the relationships implied by the data, and reuse them on later
visits. Treat the live schema as the source of truth - never recreate or drop a table that already
exists. A CRM (contacts, companies, interactions) is one thing you could build here, but the app is
not limited to it.`;

export default defineConfig({
  name: "Autocrud",
  model: anthropic("claude-haiku-4-5"), // needs ANTHROPIC_API_KEY
  database: { driver: "sqlite" },

  description,

  autoSchema: true,
  navLinks: true,
  addFields: true,

  // On a write, drop only the home page and the single-segment index pages (e.g. /widgets); leave
  // detail pages (/widgets/1) served from cache. Without this, any write invalidates every page.
  invalidateOnWrite: ["/", "/*"],

  design: `This is a web app - style the body like one, not an article. Use the classes below; a
stylesheet is already loaded.
  - Body content: <h1 class="page-title"> heading, <h2 class="section"> for small section labels,
    <p class="muted"> for secondary text.
  - Group forms in <div class="card">; put a field + button on one line with <div class="row">
    (wrap the input in <div class="field">). Inputs use class="input"; buttons use class="btn",
    "btn-primary", or "btn-danger".
  - Render collections as rows: each item is <a class="list-item" href="..."> (or a div) with the
    label on the left and a <span class="badge"> (count/status) on the right.
  - Empty states use <div class="empty">. Keep it dense.`,

  head: `<link rel="stylesheet" href="/app.css">`,
  static: "./public",

  // Applied only when rendering "/".
  indexPrompt: `Open with a one-line greeting, then the per-collection counts (each collection a link to
"/<collection>"), then the most recently created records. Always end with an "Explore" section that
suggests a gaggle of a dozen or so varied collection paths to try - things like /contacts, /tasks,
/recipes, /books, /invoices, /projects, /bookmarks, /workouts, /movies, /plants, /expenses, /clients -
each rendered as a real <a href="/<collection>"> link (not plain text) so a click creates it. Vary the
suggestions; don't list ones that already exist.`,
});
