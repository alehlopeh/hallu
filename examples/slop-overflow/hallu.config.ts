import { defineConfig } from "hallujs";
import { anthropic } from "@ai-sdk/anthropic";

export default defineConfig({
  name: "Slop Overflow",
  autoSchema: true,
  model: anthropic("claude-haiku-4-5"), // needs ANTHROPIC_API_KEY

  database: { driver: "postgres", url: process.env.HALLU_PG_URL ?? "postgres://localhost:5432/slop_overflow" },

  description: `A question-and-answer website for programmers, where users post coding problems and others post answers.

The home page lists questions, each linking to its own page that shows the question and all of its answers. Anyone can post a new question or add an answer to an existing question.

Asking a question: the "Ask Question" page is a form with a title, a body (the problem, including any code), and a tags input - a single text field where the user types one or more short tags separated by spaces or commas (like python, postgres, react). On submit, save the question and its tags, then send the browser straight to that new question's own page, so the user lands on what they just posted rather than back on the home list.

Tags: a question has zero or more tags. Show them as small labels on each question, both in the home list and on the question's page. A tag label links to a page that lists the questions carrying that tag.

Answering: a question's page has an answer form (a body field) at the bottom. Posting an answer attaches it to that question and keeps the user on the same question page, with the new answer shown in place.

Voting is the core mechanic. Both questions and answers can be voted up or down. Render an up-vote and a down-vote control next to each item with its score - up-votes minus down-votes - shown between them. Record each vote as its own row tied to the user who cast it, the item it targets, and its direction; compute an item's score by summing its votes, and don't keep a denormalized counter.

A user gets at most one vote per question and at most one vote per answer. Casting a vote where one already exists replaces it - voting the opposite way flips the direction, and voting the same way again removes it - so a user can never stack multiple votes on the same item. Sort answers on a question's page by score, highest first, so the best answer rises to the top, and sort the home page's questions by score as well.`,

  head: `<link rel="stylesheet" href="/app.css">`,
  static: "./public",
  navLinks: true,

  cacheTemplate: true,
});
