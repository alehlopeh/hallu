import { defineConfig } from "hallujs";
import { anthropic } from "@ai-sdk/anthropic";

export default defineConfig({
  name: "Slop Overflow",
  autoSchema: true,
  model: anthropic("claude-haiku-4-5"), // needs ANTHROPIC_API_KEY

  database: { driver: "postgres", url: process.env.HALLU_PG_URL ?? "postgres://localhost:5432/slop_overflow" },

  description: `A question-and-answer website for programmers: users post coding problems (questions) and others post answers. The records are questions, answers, votes, tags, and users. Every question title, tag name, and user name rendered anywhere is an <a> link to that record's page: /questions/<id>, /tags/<tag>, /users/<id>.

Score: each question and each answer has a score equal to the count of its up-vote rows minus the count of its down-vote rows. Compute it on each read by counting vote rows.

Home page (/): first an <a class="btn btn-primary" href="/questions/ask">Ask Question</a> and an <a href="/tags">Tags</a>, then a <ul class="list"> of every question ordered by score descending. Each question is an <li class="list-item"> showing: its title as an <a> to /questions/<id>, its score, its number of answers, its tag names (each an <a> to /tags/<tag>), and its asker's name as an <a> to /users/<id> with the asked date.

Ask Question page (/questions/ask): a <form> with a text <input> for the title, a <textarea> for the body, and a text <input> for tags. Split the tags input on commas and trim each piece; every non-empty piece is one tag (so "python, data structures" produces two tags: "python" and "data structures"). On submit, insert the question and its tags, render that new question's page, and set the URL to /questions/<id>.

Question page (/questions/<id>): render the question as a <div class="card"> showing its title, body, tag links (each an <a> to /tags/<tag>), asker name (an <a> to /users/<id>), asked date, score, and a vote widget. Then a <ul class="list"> of its answers ordered by score descending, each answer an <li class="card"> showing its body, author name (an <a> to /users/<id>), date, score, and a vote widget. Then a <form> with a <textarea> body field to post an answer: on submit, insert the answer for this question, render the updated question page, and set the URL to /questions/<id>.

Vote widget: beside each question or answer, render an up-vote <form> with one submit button, the score as a number, and a down-vote <form> with one submit button, in that order. A vote row records the voter, the target item's id, the target type (question or answer), and a direction of up or down. A user has at most one vote per item. On submit: if the user has no vote on that item insert one; if they have a vote in the same direction delete it; if they have a vote in the opposite direction update its direction.

Tag index (/tags): a <ul class="list"> of every tag, each an <li class="list-item"> with the tag name as an <a> to /tags/<tag> and the count of questions carrying it.

Tag page (/tags/<tag>): a <ul class="list"> of the questions carrying that tag ordered by score descending, each an <li class="list-item"> showing the title as an <a> to /questions/<id>, its score, its number of answers, and its asker name as an <a> to /users/<id>.

User profile (/users/<id>): the user's name, their total score (the sum of the scores of every question and answer they wrote), then a <ul class="list"> of the questions they asked (each title an <a> to /questions/<id>) and a <ul class="list"> of the answers they wrote, each shown as the first 80 characters of the answer body as an <a> to the /questions/<id> it belongs to.

Render code inside any question or answer body in a <pre> block to preserve whitespace.`,

  head: `<link rel="stylesheet" href="/app.css">`,
  static: "./public",
  navLinks: true,

  cacheTemplate: true,
});
