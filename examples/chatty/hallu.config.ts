import { defineConfig } from "hallujs";
import { anthropic } from "@ai-sdk/anthropic";
const description = `Chatty - a conversational AI chat app, like ChatGPT or Claude. The user chats with an AI assistant;
every conversation and message is saved and can be reopened later from a sidebar.

The assistant's replies are YOUR OWN generation as the model - when a user sends a message, you read the
conversation so far and write the assistant's reply yourself, in your own voice, then store it. There is
no separate "AI" to call: you are the assistant.

Data model:
- A \`conversations\` row is one chat thread: a short \`title\`, and created/updated timestamps.
- A \`messages\` row is one turn: it belongs to a conversation, has a \`role\` of exactly \`'user'\` or
  \`'assistant'\`, and the verbatim \`content\`. Order messages by \`created_at\` (then \`id\`) ascending.

Always render the two-pane layout (sidebar + chat panel) on every page, filling the window.

Sidebar (left, on every page):
- The "Chatty" brand label at the very top.
- A "New chat" button linking to "/".
- Below it, the list of conversations, most-recently-updated first, each linking to "/chats/:id" and
  showing its title. Mark the currently-open conversation active. Empty state: a quiet "No conversations yet".

Pages:
- "/" is a new, empty chat: the sidebar plus a friendly empty state ("How can I help?") with the composer
  directly beneath it, centered in the middle of the chat panel (not pinned to the bottom). No conversation
  exists yet - one is created when the first message is sent.
- "/chats/:id" opens a saved conversation: the sidebar plus that conversation's messages oldest-first, then
  the composer pinned at the bottom.

Messages: render user turns and assistant turns distinctly (user aligned right, assistant left). Show the
stored \`content\` VERBATIM - never paraphrase, summarize, or rewrite a stored message; it is a transcript.

Sending a message (the composer form). CRITICAL: the page is ALREADY a working chat - the sidebar, the
"messages" transcript, the composer, AND the user's just-sent message are all already on screen (the app
put them there). Your ONLY visible output is the streamed reply. You MUST NOT emit any <hallu-update>
for "hallu-root" or "messages", and MUST NOT re-render the transcript or the user's message - doing so
wipes what's already there. This is true on "/" too: even though "/" looks like a fresh chat, do NOT
rebuild it. Just do this, in order:

1. Compose your reply and deliver it with the \`stream\` tool: \`stream({ text: "...your reply..." })\`. This
   shows your reply streaming live (the app renders the assistant bubble for you) - reply as a capable,
   friendly assistant, and format with HTML: \`<p>\` for paragraphs, \`<strong>\`/\`<em>\` for emphasis,
   \`<ul>\`/\`<ol>\`/\`<li>\` for lists, and \`<pre><code>\` for code. Express every bit of formatting as HTML
   tags. Don't render a bubble for it yourself and don't repeat it in an <hallu-update>.
2. Persist with the sql tool: INSERT the user message (\`role\` \`'user'\`) and your reply (\`role\`
   \`'assistant'\`, the same text); bump the conversation's \`updated_at\`. On "/", first create the
   \`conversations\` row (a concise 3-6 word \`title\` from the first message, no quotes) and insert against it.
3. On "/" ONLY: the ONLY <hallu-update> blocks you may emit this whole turn are (a) the sidebar list
   \`conv-list\` and (b) \`<hallu-update target="hallu-navigate">/chats/<the new id></hallu-update>\` so the
   URL becomes the conversation's page. NEVER \`hallu-root\` and NEVER \`messages\` - the chat is already on
   screen; emitting those would erase the user's message and your streamed reply.

Show all stored content verbatim; the composer clears itself.`;

export default defineConfig({
  name: "Chatty",
  model: anthropic("claude-haiku-4-5"),
  streamResponses: {
    container: "messages",
    wrapper: '<div class="msg msg-assistant"><div class="bubble"></div></div>',
    html: true,
  },
  database: { driver: "sqlite" },

  description,
  routes: ["/", "/chats/*"],

  indexPrompt: `Render a fresh, empty chat: the sidebar (brand + conversations, none active), and the
chat panel. The panel MUST contain an empty transcript container <div class="messages" id="messages">
(put the "How can I help?" empty-state hint inside it), with the composer below. Do NOT render any
existing conversation's messages here. (The #messages container must be present so the first reply has
somewhere to stream into.)`,

  design: `A chat app, styled like ChatGPT/Claude. A stylesheet is loaded; use these classes.
  Always render a <div class="chat-layout"> filling the window: a <aside class="sidebar"> then a
  <section class="chat-main">.
  - Sidebar: a <div class="sidebar-brand">Chatty</div> at the very top, then
    <a class="new-chat" href="/">New chat</a>, then <nav class="conv-list"> of
    <a class="conv-item" href="/chats/:id"> (add class "active" on the open one). Empty state: <p class="empty">.
  - Chat panel (same layout on EVERY page): a scrolling transcript <div class="messages" id="messages">
    holding the turns, with the composer directly below it so the composer is pinned at the BOTTOM. Each
    turn is <div class="msg msg-user"> or <div class="msg msg-assistant"> wrapping <div class="bubble">content</div>.
    When there are no messages yet, #messages contains only <div class="empty-chat">How can I help?</div>.
  - Composer: a <form class="composer"> with a <div class="composer-inner"> inside it, holding an <input
    class="composer-input" name="message" placeholder="Message Chatty..." autocomplete="off"> and a
    <button class="send">Send</button>. It always sits after #messages, pinned at the bottom.`,

  head: `<link rel="stylesheet" href="/app.css">
<script>
  const pin = () => { const m = document.getElementById("messages"); if (m) m.scrollTop = m.scrollHeight; };
  document.addEventListener("submit", (e) => {
    const form = e.target;
    if (!form.matches || !form.matches("form.composer")) return;
    const input = form.querySelector('input[name="message"]');
    const messages = document.getElementById("messages");
    const text = input && input.value.trim();
    if (!text || !messages) return;
    const hint = messages.querySelector(".empty-chat");
    if (hint) hint.remove();
    const row = document.createElement("div");
    row.className = "msg msg-user";
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = text;
    row.appendChild(bubble);
    messages.appendChild(row);
    pin();
  });
  document.addEventListener("hallu:finalize", pin);
</script>`,
  static: "./public",

  cacheTemplate: true,

  tables: {
    conversations: {
      id: "integer primary key autoincrement",
      title: "text not null default 'New chat'",
      created_at: "text not null default current_timestamp",
      updated_at: "text not null default current_timestamp",
    },
    messages: {
      id: "integer primary key autoincrement",
      conversation_id: "integer not null references conversations(id)",
      role: "text not null check (role in ('user','assistant'))",
      content: "text not null",
      created_at: "text not null default current_timestamp",
    },
  },
});
