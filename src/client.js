// Browser runtime, served verbatim at /__hallu/client.js. Makes the app behave
// like an SPA: link clicks and form submits become actions; the model's returned
// HTML fragments are inlined in place. Only the first request is a full page load.
(() => {
  async function sendAction({ method, action, params }) {
    const response = await fetch("/__hallu/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        page: location.pathname + location.search,
        method,
        action,
        params,
      }),
    });
    if (!response.ok) throw new Error("action failed: " + response.status);

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
    const applyStreamOpen = (block) => {
      const container = document.getElementById(block.match(/\bcontainer="([^"]*)"/)?.[1] || "");
      if (!container) { missed = true; return; }
      container.insertAdjacentHTML("beforeend", innerOf(block, "hallu-stream-open"));
      let el = container.lastElementChild;
      while (el && el.firstElementChild) el = el.firstElementChild; // text streams into the innermost node
      streamEl = el;
      applied = true;
      document.body.classList.add("hallu-patched");
    };
    const applyStreamDelta = (block) => {
      if (streamEl) streamEl.insertAdjacentHTML("beforeend", innerOf(block, "hallu-stream-delta"));
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
})();
