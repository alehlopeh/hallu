// Applies the model's fragment updates to a cached page server-side, mirroring
// what the browser does - so the cache stays in sync after an action.

import { parse } from "node-html-parser";

export interface Update {
  target: string;
  html: string;
}

/** Replaces each element whose id matches an update's target with the update's html. */
export function applyUpdates(pageHtml: string, updates: Update[]): string {
  const root = parse(pageHtml);
  for (const { target, html } of updates) {
    const el = root.getElementById(target);
    if (el) el.replaceWith(html);
  }
  return root.toString();
}

/** Inner HTML of the element with the given id, or null if absent. */
export function innerOf(html: string, id: string): string | null {
  const el = parse(html).getElementById(id);
  return el ? el.innerHTML : null;
}

// --- wire format ------------------------------------------------------------
// Updates travel as raw HTML, not JSON - the model writes HTML, not HTML-escaped-
// inside-JSON (which it mis-escapes, losing the whole update). Each update is a
// <hallu-update target="id">...full replacement element...</hallu-update> block.

const CLOSE = "</hallu-update>";

/** Serialize one update to its wire block. */
export function serializeUpdate({ target, html }: Update): string {
  return `<hallu-update target="${target.replace(/"/g, "&quot;")}">${html}</hallu-update>`;
}

/** Parse update blocks out of a (possibly prose-surrounded) HTML string. */
export function parseUpdateBlocks(text: string): Update[] {
  const out: Update[] = [];
  let rest = text;
  for (let i = rest.indexOf("<hallu-update"); i !== -1; i = rest.indexOf("<hallu-update")) {
    const openEnd = rest.indexOf(">", i);
    const close = rest.indexOf(CLOSE, openEnd);
    if (openEnd === -1 || close === -1) break;
    const target = rest.slice(i, openEnd).match(/target="([^"]*)"/)?.[1];
    if (target) out.push({ target, html: rest.slice(openEnd + 1, close).trim() });
    rest = rest.slice(close + CLOSE.length);
  }
  return out;
}
