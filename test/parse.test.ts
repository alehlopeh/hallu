// The model returns its action answer as raw <hallu-update target="id">...</hallu-update>
// blocks (HTML over the wire, not JSON). parseUpdateBlocks must survive prose around
// the blocks, multiple blocks, and HTML/CSS (braces, quotes) inside them.

import { test, expect } from "bun:test";
import { parseUpdateBlocks } from "../src/dom.ts";

test("single block", () => {
  expect(parseUpdateBlocks('<hallu-update target="a"><b id="a">x</b></hallu-update>')).toEqual([
    { target: "a", html: '<b id="a">x</b>' },
  ]);
});

test("multiple blocks", () => {
  const out = parseUpdateBlocks(
    '<hallu-update target="a"><i>1</i></hallu-update><hallu-update target="b"><i>2</i></hallu-update>',
  );
  expect(out).toEqual([
    { target: "a", html: "<i>1</i>" },
    { target: "b", html: "<i>2</i>" },
  ]);
});

test("ignores prose around blocks", () => {
  const out = parseUpdateBlocks('Done!\n<hallu-update target="a"><i/></hallu-update>\nthanks');
  expect(out).toEqual([{ target: "a", html: "<i/>" }]);
});

test("HTML with css braces and quotes inside is preserved verbatim", () => {
  const html = '<div id="x"><style>.k{color:red}</style><a href="/y">y</a></div>';
  const out = parseUpdateBlocks(`<hallu-update target="x">${html}</hallu-update>`);
  expect(out).toEqual([{ target: "x", html }]);
});

test("no blocks returns empty", () => {
  expect(parseUpdateBlocks("I could not do that.")).toEqual([]);
});

test("incomplete block (no close) is skipped", () => {
  expect(parseUpdateBlocks('<hallu-update target="a"><b>x</b>')).toEqual([]);
});
