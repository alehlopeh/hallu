// The framework-owned HTML page around model-rendered content. Ships no
// content styling - only a tiny namespaced busy indicator, overridable by the app.

import type { HalluConfig } from "./index.ts";

const BUSY_STYLE = `<style>
  body.hallu-busy { cursor: progress; }
  body.hallu-busy::after {
    content: ""; position: fixed; inset: 0 0 auto 0; height: 3px; z-index: 9999;
    background: linear-gradient(90deg, #888, #fff, #888); background-size: 200% 100%;
    animation: hallu-busy 1s linear infinite;
  }
  @keyframes hallu-busy { from { background-position: 0 0; } to { background-position: 200% 0; } }
  #hallu-root { transition: opacity .2s; }
  body.hallu-busy #hallu-root { opacity: .5; pointer-events: none; }
  body.hallu-busy.hallu-patched #hallu-root { opacity: 1; }
</style>`;

// `chrome` (the nav bar) is fixed framework chrome, outside the swappable body.
// `body` is the model-rendered page content; actions only ever replace inside #hallu-root.
export function page(config: HalluConfig, chrome: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(config.name)}</title>
  ${config.head ?? ""}
  ${BUSY_STYLE}
  <script defer src="/__hallu/client.js"></script>
</head>
<body>
${chrome}
  <main id="hallu-root">
${body}
  </main>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
