import { defineConfig } from "hallujs";
import { anthropic } from "@ai-sdk/anthropic";
const description = `Shamazon - an online everything-store where the WHOLE catalog is hallucinated on demand. Every
product, department, price, rating, and review is invented the moment a shopper looks at it, then saved
so it stays the same on the next visit. It is a parody of a big-box online store: plausible products
with real-sounding specs and prices, a few of them delightfully absurd, and customer reviews with
opinions.

The schema does not exist up front - create the tables a page needs the first time it is visited, with
sensible columns and foreign keys, and reuse them afterwards. Treat the live schema as the source of
truth: never drop or recreate a table that already exists. The natural tables are:
- products: a unique \`slug\`, name, brand, price (a number), a one-line tagline, a longer description, a
  \`rating\` from 1 to 5 (one decimal is fine), a \`review_count\`, a \`department\`, and whether it's in stock.
- reviews: a foreign key to the product, a reviewer name, a star \`rating\` 1-5, a short title, the body,
  and a date.
- cart_items: a foreign key to the product and a quantity.
Design columns that fit the data; reuse a product row across every page it appears on.

Money is fake. Nothing is ever really purchased; checkout just shows a cheery "nothing was charged -
this store does not exist" confirmation.

Always LINK paths, never print a bare one - every product, department, and suggestion is a real,
clickable <a href> to its URL. Pages:
- "/" home: a big search box, a strip of department links (e.g. /c/electronics, /c/kitchen, /c/books -
  include several that don't exist yet; they materialize on click), then a "Featured" grid and a
  "Today's deals" grid of product cards, each linking to "/product/<slug>". Mix in a few products that
  aren't stored yet, rendered exactly like the rest - they're written when clicked.
- "/c/:slug" a department: a short blurb, then a grid of that department's products (generate a varied
  set the first time it is visited and store them), each a card linking to its product page. End with a
  "Related departments" row of links (some existing, some new).
- "/product/:slug" a product page: name, brand, big price, a star rating (render filled/empty stars),
  the tagline and description, a short bulleted spec list, an "Add to cart" form that POSTs to add one
  to the cart, and a "Customer reviews" section with several reviews (names, star ratings, a mix of
  glowing and critical). Below, a "Customers also bought" row of related product links.
- "/search?q=..." results: combine stored products whose name or description matches with additional
  plausible products related to the query, rendered together as ONE grid of product cards (each a link
  to "/product/<slug>" with a lowercase-hyphenated slug); the suggested ones are written when clicked.
  There are ALWAYS results - never render a "no results" message.
- "/cart" the cart: the cart_items joined to their products, with quantities, line prices, and a
  subtotal, plus a "Checkout" button whose only effect is the fake confirmation above. Empty state: a
  friendly "Your cart is empty" with a link to "/".

Adding to cart is the main write: INSERT a cart_items row (or bump the quantity if that product is
already in the cart), then confirm. Keep a product's price consistent across every page, and make the
stars shown match the stored rating.`;

export default defineConfig({
  name: "Shamazon",
  model: anthropic("claude-haiku-4-5"), // needs ANTHROPIC_API_KEY
  database: { driver: "sqlite" },

  description,

  autoSchema: true,
  navLinks: true,

  routes: ["/", "/c/*", "/product/*", "/search", "/cart"],

  // Only adding to cart mutates state. Drop the home and cart pages on a write; leave the
  // (read-only) product and department pages served from cache.
  invalidateOnWrite: ["/", "/cart"],

  design: `This is an online store - style it like a retail site, dense and scannable. A stylesheet is
loaded so use these classes.
  - Headings: <h1 class="page-title">; small section labels <h2 class="section">; secondary text
    <p class="muted">.
  - Search: <form class="search" action="/search"> with <input class="search-input" name="q"
    placeholder="Search Shamazon" autocomplete="off"> and <button class="search-btn">Search</button>.
  - Departments: a <div class="dept-row"> of <a class="dept-tile" href="/c/<slug>"> with the name.
  - Product grids: <div class="product-grid"> of <a class="product-card" href="/product/<slug>">, each
    with a <div class="thumb"> placeholder (a soft colored tile - NO external images; put a single
    relevant emoji inside), a <div class="p-name">, a <div class="price">$00.00</div>, and a
    <div class="stars">★★★★☆</div> followed by a <span class="rating-count">(123)</span>.
  - Product page: <div class="product"> wrapping a <div class="thumb thumb-lg"> and a <div class="p-info">
    holding the name, <div class="price">, <div class="stars"> + count, the description, a
    <ul class="specs"> of bullet specs, and a <form class="buy"> with a <button class="btn-buy">Add to
    cart</button>. Reviews go in a <div class="reviews"> of <div class="review"> blocks, each a
    <div class="review-head"> (reviewer name + stars), a <div class="review-title">, and a
    <p class="review-body">.
  - Cart: <div class="cart-item"> rows (thumb, name, qty, line price) and a <div class="cart-summary">
    with a <div class="subtotal">. Buttons use class "btn", "btn-buy", or "btn-checkout".
  - Render stars as filled ★ and empty ☆ characters matching the rating. Keep everything dense.`,

  head: `<link rel="stylesheet" href="/app.css">`,
  static: "./public",

  indexPrompt: `Open with the search box, then a "Shop by department" <div class="dept-row"> of about a
dozen varied department links (/c/electronics, /c/kitchen, /c/books, /c/toys, /c/garden, /c/pets,
/c/beauty, /c/grocery, /c/office, /c/automotive, /c/sports, /c/home - mix in some not yet created, each
a real <a href>). Then a "Featured" product grid and a "Today's deals" product grid of cards linking to
"/product/<slug>"; include several products that don't exist yet, rendered identically (written on
click). Vary the selection each time; don't only show products that already exist.`,
});
