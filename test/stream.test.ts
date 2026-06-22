// The `stream` tool: on a POST action, the model's tool-INPUT stream is forwarded to the browser as
// <hallu-append target="..."> frames into the model's chosen element id (live typing), followed by a
// framework <hallu-finalize>. Uses a fake model that scripts a streamed `stream` call; the path is real.

import { test, expect } from "bun:test";
import { MockLanguageModelV3 } from "ai/test";
import { convertArrayToReadableStream } from "@ai-sdk/provider-utils/test";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { createApp } from "../src/server.ts";
import { defineConfig } from "../src/index.ts";

const USAGE = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};

// Turn 1 (no tool result yet): append the user bubble + an empty assistant bubble (id reply-1),
// then a `stream` call whose input is {"target":"reply-1","text":"Hello"}. Turn 2: finish.
function sayModel() {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: "text" as const, text: "" }],
      finishReason: { unified: "stop" as const, raw: undefined },
      usage: USAGE,
      warnings: [],
    }),
    doStream: async ({ prompt }) => {
      const done = prompt.some((m) => m.role === "tool");
      const parts: LanguageModelV3StreamPart[] = done
        ? [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "t" },
            { type: "text-delta", id: "t", delta: '<hallu-update target="conv-list"><nav class="conv-list" id="conv-list"></nav></hallu-update>' },
            { type: "text-end", id: "t" },
            { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage: USAGE },
          ]
        : [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "t" },
            { type: "text-delta", id: "t", delta: '<hallu-append target="messages"><div class="msg msg-user"><div class="bubble">hi</div></div></hallu-append>' },
            { type: "text-end", id: "t" },
            { type: "tool-input-start", id: "call-stream", toolName: "stream" },
            { type: "tool-input-delta", id: "call-stream", delta: '{"text":"' },
            { type: "tool-input-delta", id: "call-stream", delta: "Hel" },
            { type: "tool-input-delta", id: "call-stream", delta: "lo" },
            { type: "tool-input-delta", id: "call-stream", delta: '"}' },
            { type: "tool-input-end", id: "call-stream" },
            { type: "tool-call", toolCallId: "call-stream", toolName: "stream", input: '{"text":"Hello"}' },
            { type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, usage: USAGE },
          ];
      return { stream: convertArrayToReadableStream(parts) };
    },
  });
}

function app() {
  return createApp(
    defineConfig({
      name: "Chatty",
      description: "test chat app",
      tables: { messages: { id: "integer primary key autoincrement", role: "text", content: "text" } },
      database: { driver: "sqlite", path: ":memory:" },
      streamResponses: { container: "messages", wrapper: '<div class="msg msg-assistant"><div class="bubble"></div></div>' },
      model: sayModel(),
    }),
  );
}

test("stream tool: framework opens an app wrapper in the container, streams text deltas in, then closes", async () => {
  const res = await app().fetch(
    new Request("http://x/__hallu/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ page: "/chats/1", method: "POST", action: "/chats/1", params: { message: "hi" } }),
    }),
  );
  expect(res.status).toBe(200);
  const body = await res.text();

  // The user's own message is echoed back before the reply streams.
  expect(body).toContain('<hallu-append target="messages">');
  expect(body.indexOf("msg-user")).toBeLessThan(body.indexOf("hallu-stream-open"));

  // The framework opens the response with the app's container + wrapper. html="0" = deltas render as
  // literal text (this app doesn't set streamResponses.html).
  expect(body).toContain('<hallu-stream-open container="messages" html="0"><div class="msg msg-assistant"><div class="bubble"></div></div></hallu-stream-open>');

  // The tool input arrives as stream-delta frames; concatenated = the full reply.
  const said = [...body.matchAll(/<hallu-stream-delta>(.*?)<\/hallu-stream-delta>/g)].map((m) => m[1]).join("");
  expect(said).toBe("Hello");

  // ...and a close frame ends the stream.
  expect(body).toContain("<hallu-stream-close></hallu-stream-close>");
});
