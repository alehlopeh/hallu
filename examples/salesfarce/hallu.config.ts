import { defineConfig } from "hallujs";
import { anthropic } from "@ai-sdk/anthropic";

const description = `Salesfarce is an enterprise CRM: accounts, contacts, leads, opportunities, cases, and
campaigns.

The schema does not exist up front. The first time a page needs an object that has no table yet, create
one with sensible columns, an id, a created_at, and relationships to the objects it relates to (an
opportunity belongs to one account; a case belongs to one account; a contact can belong to several
accounts, through a join table). Use snake_case, treat the live schema as the source of truth, and reuse a
record across every page it appears on.

Organize the app as objects, list views, and record pages. Every object, record, and related item is a
real, clickable <a href>. The navigation bar always includes a "Search" link to /search.

- "/" the home dashboard: KPI tiles, an "App Launcher" grid of object tiles, and a "Recent records" list
  when there is data to show. The home-page instructions below give the exact layout.

- "/<object>" a list view (e.g. /accounts, /opportunities): a heading with the object name, a "New"
  button linking to /<object>/new, and a data table of that object's records. Generate a varied set the
  first time the view is visited and store them. Each row links to its record page at /<object>/<id>.
  Show the columns that matter for the object - opportunities show account, amount, stage, and close date;
  accounts show name, industry, and owner. Render opportunity stages and case/lead statuses as pills.

- "/<object>/<id>" a record page: the record's fields as a labelled field grid, the record name as the
  header alongside Edit and New-related actions, and "Related lists" below showing child records. An
  account page lists its contacts, its opportunities, and its cases, each row linking to that record; an
  opportunity page shows its account, amount, stage, and contact roles. Include whichever related lists
  fit the object.

- "/<object>/new" a create form: one input per field, matched to its type (text, a number for amounts, a
  date for close dates, a select for stage or status). On submit, insert the new record and send the
  browser straight to its record page so the user lands on what they just created.

- "/reports" and "/dashboards": charts rendered as inline SVG (a pipeline funnel by stage, opportunities
  won per month, leads by source) with explicit numeric widths and heights, plus summary stat cards. Base
  them on the live data wherever it exists.

- "/search" the search page: a heading, a <form class="search" method="post" action="/search"> with a
  text input named \`q\` and a Search button, and an empty <div class="search-results" id="search-results">
  results container. On submit, refresh the container to empty, then look across the objects for records
  matching \`q\` and stream each match into it as a link to its record page at /<object>/<id>. If the query
  has no matches, stream two or three new collections the query suggests instead (the query "invoice"
  suggests /invoices), plural nouns that would hold records like it, each an <a href> to its list view
  /<collection>, so a click opens that collection.

Creating and editing records are the main writes: insert (or update) the row, then show the record. Keep
amounts, stages, owners, and names consistent across every page a record appears on. Use standard CRM
sales language: industries, lead sources, pipeline stages (Prospecting, Qualification, Proposal,
Negotiation, Closed Won, Closed Lost), territories, and owners with sales titles.`;

export default defineConfig({
  name: "Salesfarce",
  model: anthropic("claude-haiku-4-5"), // needs ANTHROPIC_API_KEY
  database: { driver: "sqlite" },

  description,

  autoSchema: true,
  navLinks: true,

  // The CRM "custom field" control: lets users add a column to any object's table from its list page.
  addFields: true,

  // Floating "edit this page" chat: users revise any page by instruction; edits persist in hallu_pages.
  pageChat: true,

  // The model re-renders every view live against the current data and reuses a pinned template per path,
  // so freshly created records show up immediately and list views are never stale.
  cacheTemplate: true,

  // First visit to a list view creates the table and seeds a set of rows (one INSERT per row) before
  // reading them back, which overruns the default 8-step cap. Give the tool loop room.
  maxSteps: 24,

  // Search streams its matches in: each result is streamed into the #search-results container, wrapped in
  // a .result row. html:true so each streamed result can be a link to its record.
  streamResponses: { container: "search-results", wrapper: '<div class="result"></div>', html: true },

  design: `Style this enterprise CRM with the classes below; a stylesheet is loaded.
  - Headings: <h1 class="page-title"> with an optional <p class="muted"> subtitle; section labels are
    <h2 class="section">.
  - Action toolbar: <div class="toolbar"> holding <a class="btn"> / <button class="btn"> actions and a
    primary <a class="btn btn-primary">New</a>.
  - Home: KPI tiles in a <div class="kpi-row"> of <div class="kpi">, each a <div class="kpi-value"> over a
    <div class="kpi-label">. The App Launcher is a <div class="obj-tiles"> of
    <a class="obj-tile" href="/<object>"> with a leading <span class="obj-icon"> emoji, the object name in
    <span class="obj-name">, and a small <span class="obj-meta"> record count.
  - Search: a <form class="search" method="post" action="/search"> with an <input class="search-input"
    name="q"> and a <button class="search-btn">Search</button>, above a
    <div class="search-results" id="search-results"> whose streamed rows are <div class="result"> elements
    holding a link to a record.
  - List views: a <table class="data-table"> with a <thead> of <th> and <tbody> rows. Make each row
    clickable by wrapping the primary cell's text in <a href="/<object>/<id>">. Put amounts and counts in
    <td class="num"> (right-aligned).
  - Stage/status pills: <span class="pill pill-open"> for in-progress, <span class="pill pill-won"> for
    won or good-closed, <span class="pill pill-lost"> for lost or bad-closed, and a plain <span class="pill">
    for neutral states.
  - Record page: <div class="record"> wrapping a <div class="record-header"> (the <h1 class="page-title">
    name plus a <div class="toolbar"> of actions), then a <div class="field-grid"> of <div class="field">
    blocks, each a <div class="field-label"> over a <div class="field-value">. Related lists go in
    <div class="related"> sections, each an <h2 class="section"> heading above a <table class="data-table">.
  - Forms: <form class="form-grid"> of <div class="field"> rows, each a <label> and an
    <input class="field-input"> / <select class="field-input"> / <textarea class="field-input">, ending in
    a <div class="toolbar"> with a <button class="btn btn-primary">Save</button>.
  - Reports: reuse <div class="kpi"> for stat cards; draw charts as inline SVG filled #0176d3 (brand blue).`,

  head: `<link rel="stylesheet" href="/app.css">`,
  static: "./public",

  indexPrompt: `Open with a "Salesfarce" <h1 class="page-title"> and a one-line subtitle. Then a
<div class="kpi-row"> of four KPI tiles (Open Pipeline, Opps This Quarter, New Leads, Open Cases) from
live data, or plausible placeholders on a fresh org. Then an "App Launcher" <h2 class="section"> over a
<div class="obj-tiles"> of object tiles, each a real <a href> to its list view: /accounts, /contacts,
/leads, /opportunities, /cases, /campaigns, /forecasts, /quotes, /territories, /products, /tasks, /events,
/contracts, /invoices, /partners, /cities, /countries, and /reports.`,
});
