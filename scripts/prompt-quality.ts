#!/usr/bin/env bun
// Prompt-quality audit. In Hallu, prose IS the program. This has an LLM judge how effective prompt strings
// are as instructions to the executor model: tight, concrete, internally consistent, free of
// marketing-at-the-model, filler, tone-performance, and self-contradiction. Two inputs:
//   - a hallu.config.ts: imports it and judges its prose fields (description / design / indexPrompt)
//   - framework source (e.g. src/llm.ts): no config export, so it audits the prompt-string constants in
//     the file text (AUTO_SCHEMA_RULES, BOUNDARY_RULES, the systemPrompt template, ...).
//
//   ANTHROPIC_API_KEY=... bun run scripts/prompt-quality.ts examples/salesfarce/hallu.config.ts
//   ANTHROPIC_API_KEY=... bun run scripts/prompt-quality.ts src/llm.ts
//   HALLU_MODEL=claude-opus-4-8 bun run scripts/prompt-quality.ts <path>
//
// Exits 0 if no high-severity findings, 1 otherwise. The judge is a live model, so reruns can vary.

import { resolve } from "node:path";
import { anthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import { z } from "zod";

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Set ANTHROPIC_API_KEY to run the prompt-quality audit.");
  process.exit(1);
}

const target = process.argv[2];
if (!target) {
  console.error("Usage: bun run scripts/prompt-quality.ts <hallu.config.ts | framework source.ts>");
  process.exit(1);
}

const absPath = resolve(process.cwd(), target);

// Config mode if the file default-exports a config object; otherwise source mode (audit the file text).
let config: Record<string, unknown> | null = null;
try {
  const mod = await import(absPath);
  if (mod.default && typeof mod.default === "object") config = mod.default as Record<string, unknown>;
} catch {
  // not importable as a module (or its deps don't resolve here) - fall back to source-text mode
}

const sourceMode = config === null;
const modeNotes: string[] = [];
let promptBody: string;

if (config) {
  // The prose fields that become part of the model's prompt. Other config is plumbing, not prompt.
  const PROMPT_FIELDS = ["description", "design", "indexPrompt"] as const;
  const fields: { field: string; text: string }[] = [];
  for (const k of PROMPT_FIELDS) {
    const v = config[k];
    if (typeof v === "string" && v.trim()) fields.push({ field: k, text: v.trim() });
  }
  if (fields.length === 0) {
    console.error("No prompt fields (description / design / indexPrompt) found on the config.");
    process.exit(1);
  }
  // What the framework already handles, so the judge doesn't flag intended latitude or ask the prompt to
  // repeat what the runtime injects on its own.
  if (config.autoSchema) {
    modeNotes.push(
      "autoSchema is ON: the model is meant to design tables and columns on demand. Leaving specifics to it " +
        "('sensible columns') is intended latitude, not vagueness - do NOT recommend pinning an exact schema.",
    );
  } else {
    modeNotes.push("autoSchema is OFF: the schema is fixed; the prompt should not ask the model to create tables.");
  }
  if (config.navLinks)
    modeNotes.push(
      "navLinks is ON: the framework generates the nav bar from a separate prompt that includes this " +
        "description, so stating which links the nav should contain (e.g. \"the nav always includes a Search " +
        "link to /search\") is the intended way to steer it, NOT a contradiction. The only nav rule for page " +
        "output is that a rendered page must not emit its own <nav> element.",
    );
  if (config.streamResponses) modeNotes.push("streamResponses is ON: actions may stream via a `stream` tool.");
  if (config.cacheTemplate) modeNotes.push("cacheTemplate is ON: each path re-renders live against the database, so persistence and freshness are handled by the runtime.");
  modeNotes.push(
    "The framework already injects rules the prompt need not restate: no <script>/JS, the page/action output " +
      "format, SQL-quote escaping, and 'render a useful view for any path rather than a 404'.",
  );
  promptBody = fields.map((f) => `### ${f.field}\n${f.text}`).join("\n\n");
} else {
  // Framework source: judge the prompt-string constants in the file text.
  promptBody = await Bun.file(absPath).text();
  modeNotes.push(
    "This is FRAMEWORK SOURCE, not an app config. Audit ONLY the prompt strings - template literals assigned " +
      "to consts or returned from rule builders (AUTO_SCHEMA_RULES, ADD_FIELDS_RULES, BOUNDARY_RULES, PAGE_RULES, " +
      "ACTION_RULES, ACTION_RULES_STREAM, PAGE_CHAT_NOTE, the systemPrompt template, etc.). Ignore the TypeScript " +
      "code, imports, types, and control flow.",
    "These fragments are assembled conditionally (e.g. AUTO_SCHEMA_RULES only when autoSchema is on), so judge " +
      "each as a standalone instruction; do not flag a fragment for not repeating another fragment's rules.",
    "${...} interpolations are runtime values (dialect-specific SQL, today's date) - treat them as filled in.",
    "Name each finding's `field` by the constant it appears in.",
  );
}

const modelId = process.env.HALLU_MODEL ?? "claude-sonnet-4-6";

const Finding = z.object({
  field: z.string().describe("Which prompt field or framework constant the issue is in."),
  severity: z.enum(["high", "medium", "low"]).describe("high: misleads the model or biases its output; medium: wastes tokens or muddies intent; low: minor."),
  category: z
    .enum(["marketing", "tone-performance", "filler", "contradiction", "vagueness", "negative-framing", "redundancy", "ambiguity"])
    .describe("The kind of defect."),
  quote: z.string().describe("The offending words, copied verbatim."),
  issue: z.string().describe("Why this weakens the prompt as an instruction to the executor model. One sentence."),
  fix: z.string().describe("The concrete tightened replacement, or the cut to make."),
});

const Report = z.object({
  verdict: z.string().describe("One terse line on the overall state of the prompts."),
  score: z.number().min(0).max(100).describe("How tight and executable the prompts are as a whole. 100 is ideal."),
  findings: z.array(Finding),
});

const intro = sourceMode
  ? `You are a prompt engineer auditing the prompt strings inside Hallu's FRAMEWORK SOURCE. These template-literal
constants are injected into the system prompt an LLM uses to render every page and apply every action against a
SQL database. Judge them only as instructions to that executor model.`
  : `You are a prompt engineer auditing the prose fields of a Hallu app config. In Hallu these strings ARE the
program: the framework injects \`description\` (domain, rules, pages), \`design\` (HTML/CSS guidance), and
\`indexPrompt\` (home-page instructions) into the system prompt an LLM uses to render every page and apply every
action against a SQL database. Judge them only as instructions to that executor model, never as marketing copy
or human-facing documentation.`;

const system = `${intro}

Effective Hallu prompts are tight (every sentence changes what the model renders or writes), concrete
(real paths, field and table names, relationships, class names instead of adjectives), internally
consistent (one vocabulary, rules that agree with each other), and plainly imperative.

Identify weaknesses, each with the exact offending quote and a concrete fix:
- marketing: words selling the app or telling the model the work is delightful, loving, beautiful,
  gloriously absurd. The model needs to be told what to build, not sold on it.
- tone-performance: instructions that make the model wink or perform (parody, be funny, tongue-in-cheek)
  where a straight description of the domain would yield the same data and a cleaner result.
- filler: adjectives and flourishes that do not change the output. (Words like "plausible" are fine when
  they genuinely constrain; ornamental phrases are not.)
- contradiction: rules that fight each other (a fixed schema alongside "create tables as needed"; two
  different stage or status lists).
- vagueness: "modern", "clean", "nice UX" with no spec the model can act on.
- negative-framing: a prohibition where a positive instruction is clearer ("render a plausible view for
  any path" beats "never 404").
- redundancy: the same instruction stated more than once where the copies could drift out of sync.
- ambiguity: an instruction that can be read two ways.

Reinforcing one critical rule at its point of use is acceptable. Do not flag intended latitude as
vagueness, do not ask a prompt to restate what is handled elsewhere, and do not invent issues to pad the
list: clean prompts should return few or no findings and a high score.

## Notes
${modeNotes.map((n) => `- ${n}`).join("\n")}`;

const prompt = sourceMode
  ? `Audit the prompt constants in this framework source.\n\n${promptBody}`
  : `Audit these prompt fields.\n\n${promptBody}`;

const { object: report } = await generateObject({
  model: anthropic(modelId),
  schema: Report,
  system,
  prompt,
});

// --- output ---------------------------------------------------------------
const order = { high: 0, medium: 1, low: 2 } as const;
const mark = { high: "✗", medium: "!", low: "·" } as const;
const findings = [...report.findings].sort((a, b) => order[a.severity] - order[b.severity]);

console.log(`\nPrompt quality: ${target}  (judge: ${modelId}${sourceMode ? ", source mode" : ""})`);
console.log(`Score ${report.score}/100  -  ${report.verdict}\n`);

if (findings.length === 0) {
  console.log("  No findings. Prompts are tight.\n");
} else {
  for (const f of findings) {
    console.log(`  ${mark[f.severity]} [${f.severity}/${f.category}] ${f.field}`);
    console.log(`      quote: ${f.quote}`);
    console.log(`      issue: ${f.issue}`);
    console.log(`      fix:   ${f.fix}\n`);
  }
  const counts = findings.reduce((m, f) => ((m[f.severity] = (m[f.severity] ?? 0) + 1), m), {} as Record<string, number>);
  console.log(`  ${findings.length} finding(s): ${counts.high ?? 0} high, ${counts.medium ?? 0} medium, ${counts.low ?? 0} low\n`);
}

process.exit(findings.some((f) => f.severity === "high") ? 1 : 0);
