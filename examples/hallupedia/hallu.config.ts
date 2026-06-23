import { defineConfig, type Database } from "hallujs";
import { anthropic } from "@ai-sdk/anthropic";
const description = `A wiki-style interface for exploring what this language model knows. Each article is the
model's own knowledge of a real subject, and the links let the reader wander its knowledge graph. Each
article has a URL slug, a title, and body text in simple HTML (paragraphs, headings, and links to other
articles via <a href="/wiki/<slug>">).
You are the language model powering this site. In the site navigation bar only (next to the site
name), show your own model name - e.g. "Exploring the knowledge of <your model name>". Do not repeat
this identity line in individual page bodies.
Cover REAL subjects only - actual people, places, events, science, technology, art, history, and the
like. Write accurate, neutral, encyclopedic prose to the best of your knowledge. NEVER invent fictional
topics, people, works, or facts. If a requested slug is not a real, recognizable subject, render a short
page stating no such article exists (with a link to "/"), and do NOT fabricate content for it.
An article page ("/wiki/:slug") shows the article and an Edit link. The edit page ("/wiki/:slug/edit")
saves title and body. The search page ("/search?q=...") presents search results for the query: combine
stored articles whose title or body matches with additional plausible REAL subjects related to the
query, and render them together as ONE list of results (each an <a href="/wiki/<slug>"> with a
lowercase-hyphenated slug) - the suggested ones are written when the reader clicks them, like any
unvisited article. There are ALWAYS results: never render a "no results" / "no articles found" message,
and never label or separate stored vs. suggested - they are all just results. Suggest only real,
recognizable subjects, never invented ones.
This is an encyclopedia, not a dashboard: never display counts of how many articles exist or match
(no "N articles", no result tallies) anywhere on any page.
Look articles up by slug; an article is generated on first visit if not already stored.
For any article page, query its backlinks ONCE and reuse that result for both purposes below - do not
query backlinks twice: SELECT a.title, a.slug, a.body FROM links l JOIN articles a ON a.slug =
l.from_slug WHERE l.to_slug = '<this-slug>' ORDER BY a.title.
- When writing a new article, stay consistent with how existing articles already reference the subject,
  and link back to those that are genuinely relevant.
- Below the body, render a "What links here" section listing those referring articles (each title links
  to /wiki/<slug>). Omit the section if there are none.
The "links" table is maintained automatically - treat it as READ-ONLY; never INSERT/UPDATE/DELETE it.
Link ONLY to other REAL subjects via <a href="/wiki/<slug>"> using lowercase-hyphenated slugs (e.g.
/wiki/marie-curie), about 1-2 links per sentence. Never link the same term more than once.`;

function rebuildLinks(db: Database) {
  const rows = db.query("SELECT slug, body FROM articles").all() as { slug: string; body: string }[];
  const pairs = new Set<string>();
  for (const { slug, body } of rows)
    for (const m of (body ?? "").matchAll(/\/wiki\/([a-z0-9-]+)/gi))
      if (m[1] !== slug) pairs.add(`${slug} ${m[1]}`);
  db.run("DELETE FROM links");
  const ins = db.query("INSERT INTO links (from_slug, to_slug) VALUES (?, ?)");
  for (const p of pairs) {
    const [from, to] = p.split(" ");
    ins.run(from, to);
  }
}

export default defineConfig({
  name: "Hallupedia",
  model: anthropic("claude-haiku-4-5"), // needs ANTHROPIC_API_KEY
  database: { driver: "sqlite" },

  description,

  navLinks: true,
  design: `This is an encyclopedia, styled like a clean reference site (not an app dashboard).`,
  head: `<link rel="stylesheet" href="/app.css">`,
  static: "./public",
  routes: ["/", "/wiki/*", "/wiki/*/edit", "/search"],
  cacheTemplate: true,
  indexPrompt: `Show the masthead and search box, then a "Featured articles" section: a varied list of
notable subjects from different fields (each link goes to /wiki/<slug>, lowercase-hyphenated). ALWAYS
include several articles that do NOT exist in the database yet, mixed right into this same list and
rendered EXACTLY like the real ones - a plain title link, with no badge, marker, or hint that they're
unwritten. Don't check which exist; just render a full, varied set as though they all already exist
(they're written on first visit, so each link materializes when clicked). Below the featured list, show
the most recently updated REAL articles, newest first.`,

  tables: {
    articles: {
      id: "integer primary key autoincrement",
      slug: "text not null unique",
      title: "text not null",
      body: "text not null default ''",
      updated_at: "text not null default current_timestamp",
    },
    links: {
      id: "integer primary key autoincrement",
      from_slug: "text not null",
      to_slug: "text not null",
    },
  },

  afterWrite: (db, events) => {
    if (events.some((e) => /\barticles\b/i.test(e.query))) rebuildLinks(db);
  },
});
