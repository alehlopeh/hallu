// The framework-owned HTML page around model-rendered content. Ships no
// content styling - only a tiny namespaced busy indicator, which an app can switch off (busyIndicator:
// false) to style the hallu-busy / hallu-patched classes itself.

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

// The page-chat control: a floating button that opens a panel for editing the page by instruction.
// Framework chrome, outside #hallu-root so it survives content swaps. Wired up by client.js.
const CHAT_STYLE = `<style>
  #hallu-chat { position: fixed; right: 20px; bottom: 20px; z-index: 10000; font: 13px/1.45 system-ui, sans-serif; }
  #hallu-chat-toggle { width: 48px; height: 48px; border-radius: 50%; border: none; background: #111; color: #fff; font-size: 19px; cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,.3); }
  #hallu-chat-toggle:hover { background: #333; }
  #hallu-chat-panel { display: none; position: absolute; right: 0; bottom: 60px; width: 320px; max-width: 82vw; background: #fff; color: #111; border: 1px solid #ddd; border-radius: 12px; box-shadow: 0 12px 44px rgba(0,0,0,.26); overflow: hidden; }
  #hallu-chat.open #hallu-chat-panel { display: block; }
  #hallu-chat-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; font-weight: 600; background: #111; color: #fff; }
  #hallu-chat-manage { font-weight: 500; font-size: 12px; color: #bbb; text-decoration: underline; }
  #hallu-chat-manage:hover { color: #fff; }
  #hallu-chat-log { max-height: 240px; overflow-y: auto; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
  #hallu-chat-log:empty { display: none; }
  .hallu-chat-msg { padding: 7px 10px; border-radius: 10px; max-width: 86%; }
  .hallu-chat-user { align-self: flex-end; background: #111; color: #fff; }
  .hallu-chat-bot { align-self: flex-start; background: #f0f0f0; color: #333; }
  #hallu-chat-form { display: flex; gap: 6px; padding: 10px; border-top: 1px solid #eee; }
  #hallu-chat-input { flex: 1; resize: none; border: 1px solid #ccc; border-radius: 8px; padding: 7px 9px; font: inherit; }
  #hallu-chat-input:focus { outline: none; border-color: #111; }
  #hallu-chat-form button { padding: 0 14px; border: none; border-radius: 8px; background: #111; color: #fff; font-weight: 600; cursor: pointer; }
  #hallu-chat-form button:hover { background: #333; }
</style>`;

const CHAT_WIDGET = `<div id="hallu-chat">
    <div id="hallu-chat-panel">
      <div id="hallu-chat-head"><span>Edit this page</span><a id="hallu-chat-manage" href="/hallu-pages">Saved edits</a></div>
      <div id="hallu-chat-log"></div>
      <form id="hallu-chat-form" data-hallu="off">
        <textarea id="hallu-chat-input" rows="2" placeholder="Ask to change this page…"></textarea>
        <button type="submit">Send</button>
      </form>
    </div>
    <button id="hallu-chat-toggle" type="button" aria-label="Edit this page">✦</button>
  </div>`;

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
  ${config.busyIndicator === false ? "" : BUSY_STYLE}
  ${config.pageChat ? CHAT_STYLE : ""}
  <script defer src="/__hallu/client.js"></script>
</head>
<body>
${chrome}
  <main id="hallu-root">
${body}
  </main>
  ${config.pageChat ? CHAT_WIDGET : ""}
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
