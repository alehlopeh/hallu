// Browser runtime, served verbatim at /__hallu/client.js. Makes the app behave
// like an SPA: link clicks and form submits become actions; the model's returned
// HTML fragments are inlined in place. Only the first request is a full page load.
(() => {
  async function post(url, body) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error("request failed: " + response.status);

    // Updates stream as raw HTML blocks: <hallu-update target="id">...</hallu-update> replaces an
    // element; <hallu-append target="id">...</hallu-append> appends text into one (live streamed output).
    let missed = false;
    let applied = false;
    let navigateTo = null;
    const innerOf = (block, tag) => block.slice(block.indexOf(">") + 1, block.length - `</${tag}>`.length);
    const targetOf = (block) => block.match(/\btarget="([^"]*)"/)?.[1];

    const applyUpdate = (block) => {
      const target = targetOf(block);
      if (!target) return;
      const inner = innerOf(block, "hallu-update").trim();
      // Special target: change the address bar after the action (POST-redirect-GET analog). The
      // content is patched by the other updates; this just moves the URL so later actions post the
      // new path. No DOM lookup, so it never counts as a miss.
      if (target === "hallu-navigate") {
        navigateTo = inner;
        applied = true;
        return;
      }
      const el = document.getElementById(target);
      if (el) el.outerHTML = inner;
      else missed = true;
      applied = true;
      document.body.classList.add("hallu-patched"); // un-dim: content is current while final response streams
    };

    // Append a block to a container's end: a complete new element (raw HTML from the model) or a
    // streamed text delta (HTML-escaped on the wire, so entities decode to text - no markup injection).
    const applyAppend = (block) => {
      const target = targetOf(block);
      if (!target) return;
      const el = document.getElementById(target);
      if (el) el.insertAdjacentHTML("beforeend", innerOf(block, "hallu-append"));
      else missed = true;
      applied = true;
      document.body.classList.add("hallu-patched");
    };

    // Streamed responses (the `stream` tool): the framework opens one by appending an app-supplied
    // wrapper into a container, streams text deltas into the wrapper's innermost element, then closes.
    let streamEl = null;
    let streamHtml = false; // does this stream render its deltas as HTML markup, or as literal text?
    let streamAcc = ""; // accumulated decoded HTML for an html-mode stream (re-set as innerHTML each delta)
    // Deltas arrive entity-escaped on the wire (so they can't break the frame). Decode them back.
    const unescapeFrame = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    const applyStreamOpen = (block) => {
      const container = document.getElementById(block.match(/\bcontainer="([^"]*)"/)?.[1] || "");
      if (!container) { missed = true; return; }
      streamHtml = block.match(/\bhtml="([^"]*)"/)?.[1] === "1";
      streamAcc = "";
      container.insertAdjacentHTML("beforeend", innerOf(block, "hallu-stream-open"));
      let el = container.lastElementChild;
      while (el && el.firstElementChild) el = el.firstElementChild; // text streams into the innermost node
      streamEl = el;
      applied = true;
      document.body.classList.add("hallu-patched");
    };
    const applyStreamDelta = (block) => {
      if (!streamEl) return;
      const inner = innerOf(block, "hallu-stream-delta");
      if (streamHtml) {
        // Render as markup: accumulate the full HTML and re-parse it each delta. The browser auto-closes
        // partial tags, so it renders progressively and self-corrects once a tag finishes arriving.
        streamAcc += unescapeFrame(inner);
        streamEl.innerHTML = streamAcc;
      } else {
        // Literal text: the escaped entities decode to characters, no markup is interpreted.
        streamEl.insertAdjacentHTML("beforeend", inner);
      }
    };
    const applyStreamClose = () => {
      streamEl = null;
      document.dispatchEvent(new CustomEvent("hallu:finalize", {})); // apps can react, e.g. scroll to bottom
    };

    let buffer = "";
    const drain = () => {
      for (;;) {
        const start = buffer.indexOf("<hallu-");
        if (start === -1) break;
        const nameLen = buffer.slice(start + 1).search(/[\s>]/);
        if (nameLen === -1) break; // tag name not fully arrived yet
        const tag = buffer.slice(start + 1, start + 1 + nameLen);
        const close = `</${tag}>`;
        const end = buffer.indexOf(close, start);
        if (end === -1) break; // incomplete block - wait for more
        const block = buffer.slice(start, end + close.length);
        if (tag === "hallu-update") applyUpdate(block);
        else if (tag === "hallu-append") applyAppend(block);
        else if (tag === "hallu-stream-open") applyStreamOpen(block);
        else if (tag === "hallu-stream-delta") applyStreamDelta(block);
        else if (tag === "hallu-stream-close") applyStreamClose();
        buffer = buffer.slice(end + close.length);
      }
    };

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      drain();
    }
    buffer += decoder.decode();
    drain();

    if (navigateTo) history.pushState({}, "", navigateTo); // content already patched; just move the URL
    else if (!applied || missed) location.reload(); // server error mid-stream, or cache/DOM diverged
  }

  async function sendAction({ method, action, params }) {
    return post("/__hallu/action", { page: location.pathname + location.search, method, action, params });
  }

  function busy(on) {
    document.body.classList.toggle("hallu-busy", on);
    if (!on) document.body.classList.remove("hallu-patched");
    document.querySelectorAll("form button, form input[type=submit]").forEach((el) => (el.disabled = on));
  }

  async function run(payload, after) {
    busy(true);
    try {
      await sendAction(payload);
      after && after();
    } catch (err) {
      console.error(err);
      location.reload();
    } finally {
      busy(false);
    }
  }

  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.dataset.hallu === "off") return;
    event.preventDefault();
    const params = Object.fromEntries(new FormData(form));
    const submitter = event.submitter;
    if (submitter && submitter.name) params[submitter.name] = submitter.value;
    form.reset(); // clear inputs on submit; params are already captured above
    run({
      method: (form.getAttribute("method") || "post").toUpperCase(),
      action: form.getAttribute("action") || location.pathname,
      params,
    });
  });

  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest("a[href]");
    if (!link || link.dataset.hallu === "off") return;
    if (link.target && link.target !== "_self") return;
    if (link.origin !== location.origin) return;
    event.preventDefault();
    const href = link.pathname + link.search;
    run({ method: "GET", action: href, params: {} }, () => history.pushState({}, "", href));
  });

  window.addEventListener("popstate", () => location.reload());

  // Page-chat panel (framework chrome, present when pageChat is on): edit the page by instruction.
  const chatRoot = document.getElementById("hallu-chat");
  if (chatRoot) {
    const toggle = document.getElementById("hallu-chat-toggle");
    const form = document.getElementById("hallu-chat-form");
    const input = document.getElementById("hallu-chat-input");
    const log = document.getElementById("hallu-chat-log");
    const addMsg = (who, text) => {
      const el = document.createElement("div");
      el.className = "hallu-chat-msg hallu-chat-" + who;
      el.textContent = text;
      log.appendChild(el);
      log.scrollTop = log.scrollHeight;
      return el;
    };
    toggle.addEventListener("click", () => {
      chatRoot.classList.toggle("open");
      if (chatRoot.classList.contains("open")) input.focus();
    });
    // The form is data-hallu="off", so the global submit handler skips it and we post to revise ourselves.
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      addMsg("user", text);
      const status = addMsg("bot", "Revising the page…");
      busy(true);
      try {
        await post("/__hallu/revise", { page: location.pathname + location.search, instruction: text });
        status.textContent = "Updated.";
      } catch (err) {
        console.error(err);
        status.textContent = "That didn't work. Try rephrasing.";
      } finally {
        busy(false);
      }
    });
  }
})();
