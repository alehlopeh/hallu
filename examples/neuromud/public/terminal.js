// Terminal behaviour for the MUD log. Runs independently of the 3D-map module (which can fail to load
// three.js from the CDN): pins the log to its newest line, and echoes the typed command into the log the
// instant you hit enter. The model only streams the result back, never your command.
(function () {
  var pin = function () {
    var l = document.getElementById("log");
    if (l) l.scrollTop = l.scrollHeight;
  };
  var focusCommand = function () {
    var i = document.querySelector("form.command .command-input");
    if (i) i.focus();
  };

  // Click an actionable word in the streamed log to run it as a command immediately. A span is clickable if
  // it has a data-player-action attribute, OR it is an exit (.exits is always clickable - directions and the
  // jack in/out exit). The attribute's value is the command verb ("attack", "talk to", "take", "go"),
  // prepended to the span's name, so clicking "Joe" runs "talk to Joe"; with no verb (an exit) the span's own
  // text is the command, so "north" runs "north" and "jack in" runs "jack in". A click drops it in and submits.
  var commandField = function () {
    return document.querySelector("form.command .command-input");
  };

  // The command an actionable span resolves to: its data-player-action verb prepended to its name
  // ("talk to Joe"), or just its text for a verbless exit ("north", "jack in"). Returns null for a
  // non-actionable element or a section label like "Exits:".
  var actionSpan = function (el) {
    var log = el.closest && el.closest(".log");
    if (!log) return null;
    var span = el.closest("[data-player-action], .exits"); // exits are always actionable, attribute or not
    if (!span || !log.contains(span)) return null;
    var text = span.textContent.trim();
    if (!text || /:$/.test(text)) return null; // ignore section labels like "Exits:"
    var action = span.getAttribute("data-player-action"); // command verb ("attack", "go", ...); empty/absent = run text as-is
    return { span: span, cmd: action ? action + " " + text : text };
  };

  // A ghost overlay sized to cover the command input, shown on hover to preview the command a click submits.
  // CSS handles the fade (opacity transition); it never touches the input's value, so typed text is untouched.
  var previewEl = null;
  var showPreview = function (cmd) {
    var form = document.querySelector("form.command");
    var input = form && form.querySelector(".command-input");
    if (!form || !input) return;
    if (!previewEl || !form.contains(previewEl)) {
      previewEl = document.createElement("div");
      previewEl.className = "command-preview";
      previewEl.setAttribute("aria-hidden", "true");
      form.appendChild(previewEl);
    }
    previewEl.style.left = input.offsetLeft + "px"; // cover the input exactly (offsetParent is form.command)
    previewEl.style.top = input.offsetTop + "px";
    previewEl.style.width = input.offsetWidth + "px";
    previewEl.style.height = input.offsetHeight + "px";
    previewEl.textContent = cmd;
    previewEl.classList.add("show");
  };
  var hidePreview = function () {
    if (previewEl) previewEl.classList.remove("show");
  };

  document.addEventListener("click", function (e) {
    if (!e.target.closest) return;
    if (document.body.classList.contains("hallu-busy")) return; // a turn is still rendering - ignore clicks
    var redo = e.target.closest(".cmd-redo");
    if (redo) { // resend this line's command, same path as Enter
      var ri = commandField();
      if (ri && redo.dataset.cmd) {
        ri.value = redo.dataset.cmd;
        ri.focus();
        var rf = document.querySelector("form.command");
        if (rf) rf.requestSubmit();
      }
      return;
    }
    var hit = actionSpan(e.target);
    if (!hit) return;
    hidePreview();
    var i = commandField();
    if (i) { i.value = hit.cmd; i.focus(); }
    var form = document.querySelector("form.command");
    if (form) form.requestSubmit(); // run the clicked command right away (same path as Enter)
  });

  // Hover an actionable span to preview, as an overlay over the command field, the exact command a click would
  // submit; leaving the span hides it. Never steals focus or alters typed text.
  document.addEventListener("mouseover", function (e) {
    if (!e.target.closest) return;
    if (document.body.classList.contains("hallu-busy")) return;
    var hit = actionSpan(e.target);
    if (hit) showPreview(hit.cmd);
  });
  document.addEventListener("mouseout", function (e) {
    if (!e.target.closest) return;
    if (!e.target.closest("[data-player-action], .exits")) return; // only act when leaving an actionable span
    var to = e.relatedTarget;
    if (to && to.closest && to.closest("[data-player-action], .exits")) return; // moving onto another link - keep
    hidePreview();
  });

  // hallu:finalize is dispatched on document and does NOT bubble, so it must be listened for on document.
  // It fires when the visible response has finished streaming.
  document.addEventListener("hallu:finalize", function () {
    pin();
    focusCommand(); // keep the cursor in the command box
    // NOTE: do NOT clear hallu-busy here. finalize fires on EVERY streamed line (the model streams one
    // line per call), so clearing it on the first line would unlock clicks while the rest still streams.
    // client.js owns the lock and clears it (busy(false)) only after the whole response is consumed.
  });

  addEventListener("DOMContentLoaded", function () {
    pin();
    focusCommand();
  });

  document.addEventListener("submit", function (e) {
    var f = e.target;
    if (!f || !f.matches || !f.matches("form.command")) return;
    var input = f.querySelector('input[name="command"]');
    var log = document.getElementById("log");
    var text = input && input.value.trim();
    if (!text || !log) return;
    var line = document.createElement("div");
    line.className = "log-line you";
    line.textContent = "> " + text;
    // a small reload button on the far right that re-runs this exact command when clicked
    var redo = document.createElement("button");
    redo.type = "button";
    redo.className = "cmd-redo";
    redo.dataset.cmd = text;
    redo.setAttribute("aria-label", "Resend this command");
    redo.title = "Resend";
    redo.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></svg>';
    line.appendChild(redo);
    log.appendChild(line);
    pin();
  });

})();
