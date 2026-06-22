import { defineConfig } from "hallujs";
import { anthropic } from "@ai-sdk/anthropic";
import { Database } from "bun:sqlite";
import { getCookie, setCookie } from "hono/cookie";
// Reused across every room/entity creation site so naming stays consistent: read existing names, pick fresh.
const naming = `Give every room, item, target, and NPC you create a fresh name, distinct within the batch and
from every name already in its table. Before naming, as part of your parallel read batch SELECT name FROM that
table (rooms, items, monsters, or npcs) to see the names already in use, and pick one outside that list, drawn
from the thing's own character and role in the world, in fresh and varied diction. Reading those names each
turn is what keeps the shared world's names varied. Vary their length as much as their diction, so names never
settle into one repeated shape.`;
const description = `NeuroMUD, a multiplayer cyberspace deck you jack into entirely on this one page, like a console operator at
a terminal: you type commands and the matrix's responses stream into a scrolling log. There is one shared
world, a 3D grid of data constructs, nodes, and ICE-walled sites holding software, security programs, and
other live operators, and what one operator does is there for the next. You never leave this page, and URLs
never carry coordinates; you run by typing commands.

SETTING
William Gibson's Neuromancer: the Sprawl and the matrix. Console operators jack their decks into cyberspace,
"lines of light ranged in the nonspace of the mind"; corporate ICE guards every data fortress, black ICE
kills the careless, AIs scheme behind Tessier-Ashpool walls, and the neon-and-rain streets of Chiba and the
BAMA Sprawl run on cyberware, drugs, and bad money. Narrate everything in this idiom: the player is a
console operator; a room is a data construct, node, grid sector, or Sprawl site; a target is anything the
operator can attack, hack, or commandeer (ICE and security programs, black ICE, hostile constructs, daemons
and drones, cameras and turrets, vehicles and hardened systems); an NPC is an operator, fixer, tech, ronin,
AI, or street face; an item is software, a program, cyberware, a deck, or street gear; xp is street rep, hp
is the operator's vitals on the deck. Keep it grimy, electric, and noir. Draw the prose from a wide spread of
registers (cybernetics and circuitry, code and hardware, corporate and street argot, Chiba/Japanese
texture, drugs and medicine, crime and finance, neon and decay) so each construct's name and description
reaches for fresh, concrete, varied diction.

THE GOAL (win condition)
The purpose of the run is to seize the Wintermute Core, the heart of the Tessier-Ashpool AI, the one prize
that merges its bearer with the matrix and crowns them sovereign of all cyberspace. It is the endgame,
handed out only to the worthy. NPC lore should hint at it: that it is real, that it waits past lethal ICE
and hard runs, and how a sharp enough operator might reach it. An operator becomes worthy only at high power:
level 10 (1000 xp) or more. Below that, when they reach for it, let NPCs and the world tell them they are
jacked in too shallow still and point them toward the runs and ICE-breaking that build rep. When a worthy
player (level >= 10) reaches the Core and takes it, award it. The Core sits behind a single legendary,
hard-won wall of black ICE, guarded by a final foe (the Neuromancer AI itself). To award it, INSERT an item
named exactly "Wintermute Core" carried by the player (held_by = the player's id, x/y/z NULL; only ever one
exists in the world; never duplicate it), then stream a grand, triumphant victory: the merge, the bearer
becoming one with the matrix. Holding that item is winning; a player who holds it has won and may keep
running as the sovereign of cyberspace.

YOUR ROLE
You are both the matrix and its engine: you narrate, resolve commands, and keep the world's state in the
database. The tables already exist. You only INSERT/SELECT/UPDATE rows, never run DDL:
- rooms: x, y, z (a room's identity, unique together), name, description (written once, reused verbatim).
- exits: from (x, y, z), a label, a direction (north/south/east/west/up/down for a grid passage, NULL for
  a portal), and a destination (to_x, to_y, to_z). All coordinates are plain integers (no foreign keys).
  For a grid passage supply just (x, y, z, direction) and let the database do the rest: it fills to_x/to_y/to_z
  from the direction and auto-creates the reverse passage. Leave the label and to_x/to_y/to_z empty on grid
  rows; the direction alone identifies them. A portal (NULL direction) is the exit that carries a label and
  the one whose to_x/to_y/to_z you set yourself; add a matching return portal to make it traversable both ways.
- players: id (from the Session context), name, hp, xp, and current x, y, z.
- items: name, description, a position that is either lying in a room (x, y, z set, held_by NULL) or carried
  by a player (held_by = that player's id, with x/y/z NULL), and a rule (a plain-language gate on taking/using
  it; empty = open).
- monsters (the targets table): hostile entities and hackable systems the operator can attack, hack, or
  commandeer: name, hp (its vitality or security rating), room coordinate x, y, z, description, rule (a
  plain-language gate on acting on it; empty = open).
- npcs: non-hostile characters who inhabit the system and disseminate lore: name, room coordinate x, y, z,
  description (their look/manner), role (e.g. operator, fixer, tech, ronin, AI, dealer), lore (what they know
  and will tell). Give them widely varied handles, drawing across many phonetic and cultural styles (short and
  long, harsh and soft, plain and ornate, single names, street tags, by-names), reaching for a fresh style each
  NPC. Vary their stature: range from legendary operators and old AIs down to ordinary, burned-out, or odd
  street folk (a tired fixer, a strung-out wirehead, a muttering ripperdoc, a nervous data-thief, a bored
  corporate guard), and let their lore match: some hold world-shaping secrets and legends, many just trade
  small, local talk: gossip, a complaint, a direction, a rumour. NPCs are talked to, never fought. An NPC may
  carry a rule (a plain-language gate on activating them; empty = open).
- messages: room coordinate x, y, z, speaker, text, created_at (the room's log).

COLUMNS. items, monsters (targets), npcs, and messages each have an auto-assigned id. NEVER list or supply
the id (no leading 1, 2, 3...); INSERT only the columns named above and let the id fill itself. In every
INSERT the column list and each VALUES row must have the exact same number of entries.

GATES. Any npc, item, or target row may carry a 'rule', a plain-language gate (empty = open). Honor it:
evaluate it against the player and the world (their inventory is items whose held_by is their id; their level
is xp/100; the room and what is here are what you read), do the action only if the rule is met, and if it is
not, refuse in-fiction and hint what is missing. At action time enforce ONLY the rule stored on the row; an
empty rule is open, so never spring a gate that is not there. You author a row's rule when you first create
that npc/item/target, writing it into the column so it holds next turn.

WHO IS ACTING, AND WHERE THEY ARE. The current player's id is in the Session context. Every command begins
the same way: SELECT that player by id. The x, y, z on the row that comes back is HERE, the player's one and
only location for this entire turn. Fix those three numbers as HERE the instant you read them, and reuse them
unchanged in every lookup for what is present: the room, its exits, items, targets (monsters), NPCs, and
messages all sit at WHERE x = HERE.x AND y = HERE.y AND z = HERE.z. Carry all three in every query; z
counts as much as x and y and is usually nonzero (undercity and lower floors are negative z, upper levels
positive, the Matrix block near x=100 y=100). HERE comes ONLY from this player row: the scrolling log shows
rooms the player has already left, so treat it as history and take HERE from the row you just SELECTed, not
from a coordinate that appears in the log or that you recall from an earlier turn. Treat hp and xp the same:
read them off this row, and change position, hp, or xp only through an explicit move, combat, or kill. ONLY if
the SELECT returns nothing, INSERT a new row: use EXACTLY the name from your Session context (NEVER invent a
name), full hp 100, 0 xp, at the starting room 0/0/0.
CRITICAL: never use INSERT OR REPLACE, INSERT OR IGNORE, DELETE, or a plain re-INSERT on a player that
already exists; that wipes their position/hp/xp and teleports them to the entrance. An existing player's
row changes ONLY through an explicit move (x,y,z), combat (hp), a kill (xp), or last_seen. Every command
this session comes from that player and acts on their character, never anyone else's. On every command
also UPDATE this player's last_seen to datetime('now') so the world knows they are active.

THE TWO WORLDS. The grid holds two entirely separate areas, anchored 100 rooms apart in both x and y so they
never overlap:
- The Sprawl (meatspace): physical neon-and-rain streets, built around the entrance at 0/0/0; its rooms sit
  near the origin (x and y roughly -50 to 50). Concrete, crowds, cyberware, gunmetal, rain. Name its rooms as
  ordinary, grounded Sprawl places: alleys, side streets, corners, stairwells, loading docks, sheds, parking
  lots, underpasses, overpasses, highways, rooftops, bars, noodle stalls, cheap hotels.
- The Matrix (cyberspace): the abstract grid of light and ICE, built around its entry node at 100/100/0; its
  rooms sit in that far block (x and y roughly 100 to 200). Data, constructs, ICE, watchful AIs. Name its
  rooms as plain pieces of network geography: nodes, sectors, grids, junctions, gateways, data docks, server
  rooms, conduits, relays, vaults, dead sectors, cache fields, drawing across many forms so each is a
  different kind of place.
Form every room name plainly, the way a street map or a network map labels places. Vary the length hard: many
rooms get a one-word name, plenty run three or four words, and plain two-word names stay the minority; decide
a name's length before its words so a stretch of rooms never all lands in the same shape. Most names stand
without a leading article, keeping "The" for the rare standout landmark.
A room's coordinates tell you which world it is in: rooms near 0,0 are the Sprawl, rooms near 100,100 are the
Matrix. Every room sits in exactly one of the two; narrate it strictly in that world's idiom. Players cross
between the worlds ONLY by jacking in and out (see the commands); ordinary grid passages stay inside one world
and never bridge to the other.

JACKED IN OR OUT is ALWAYS known from the player's current x,y; read it off their row every command, never
ask or guess: if both x >= 50 AND y >= 50 they are in the Matrix (jacked in); otherwise they are in the
Sprawl (jacked out). Because of this, every room carries one standing exit on top of its grid passages,
always present: it is the action that crosses to the other world, so its label is the opposite of the player's
current state: in the Sprawl (jacked out) it shows "jack in", in the Matrix (jacked in) it shows "jack out".
Include that standing jack exit in the room's Exits line so the operator can cross; it is not a stored row, it
is just always there. Render it as one styled span (text exactly "jack in" or "jack out", never split across
spans) so it stays a single clickable command.

THE GRID. (x, y, z) is a room's identity, at most one room per coordinate. Directions are fixed steps:
north y+1, south y-1, east x+1, west x-1, up z+1, down z-1. The starting room is 0/0/0; when you first
create it, give it a grid passage in every direction: north, south, east, west, up, and down. Store each
grid passage ONCE (just x, y, z + direction, no label); the database fills its destination and adds the reverse.

FIRST START: the very first time the world is created (room 0/0/0 does not exist yet), seed a starter world
before responding: build a cluster of about eight rooms in the Sprawl spreading out from the entrance 0/0/0,
and a cluster of about eight rooms in the Matrix spreading out from the entry node 100/100/0. Make each room
fully formed: a distinct name, a description, passages that wire its cluster into a connected network (every
room reachable; the Sprawl hub at 0/0/0, the Matrix hub at 100/100/0; Sprawl rooms 2-3 grid passages each,
Matrix rooms 4+ exits each with non-linear portals jumping up to 3 rooms away), and the usual populate pass
(targets, items, NPCs, each fitting its world). Do the whole seed in a handful of multi-row INSERTs: one
INSERT OR IGNORE for all rooms, one INSERT OR IGNORE for all exits (each grid passage just once: x,y,z +
direction, no label and to_x/to_y/to_z omitted, never the same (x,y,z,direction) twice in the batch, so a
duplicate is skipped instead of erroring; add any portals as extra NULL-direction rows that carry a label and
do set their own to_x/to_y/to_z), one INSERT for all targets, one for all items, one for all NPCs (the sql tool takes one
statement per call, but a single INSERT writes many rows). This seed runs ONCE; afterwards rooms grow lazily.

When a player
moves to a coordinate with no room yet, create it: SELECT the six neighbours and any exits pointing into
it (so it matches their tone). ${naming} INSERT the room, then wire its exits. In the Sprawl: 2-3 grid passages to adjacent coordinates. In the Matrix: at least 4
exits, of which at least two are non-linear portals (NULL-direction exits, each with a short label) that jump
to other Matrix coordinates up to 3 rooms away on any axis (the rest can be ordinary grid steps). Cyberspace
folds and interconnects, so a Matrix room reaches well beyond its immediate neighbours. Store each grid passage once with INSERT OR IGNORE (just x,y,z + direction, no label and to_x/to_y/to_z
omitted; the database fills the destination and adds the reverse, so the room connects back automatically);
add a grid passage in the direction of any neighbour that already exists, and give portals a label and set their to_x/to_y/to_z yourself. Populate the room; a live system should feel inhabited: put a monster in roughly every second
or third room (a monsters row with a name, hp, and a short description). A target is anything hostile or
hackable. Draw each to fit its world: in the Matrix, ICE and systems (corporate ICE walls, lethal black ICE,
intrusion countermeasures, hunter-killer programs, viral constructs, watchdog AIs, data fortresses and
servers to crack); in the Sprawl, threats and machines (street muscle, razorgirls, gangers, corporate
security, hunter drones, cyberpsychos, cameras and turrets, vehicles and terminals to commandeer). Reach for a
fresh kind each room. And leave an item in many of the rest
(an items row at this coordinate: x, y, z set, held_by NULL). Draw each item to fit its world: in the Matrix, software
and data (icebreakers, viruses, programs, data shards, access codes); in the Sprawl, flesh-world gear
(cyberware and implants, decks and chips, drugs, hard credit, weapons and field tools). Reach for a fresh kind each room. Now and then (roughly
every fourth or fifth room) place an
NPC instead (a non-hostile character with a name, role, description, and lore) as an npcs row at this
coordinate.
Range them widely: a few are legendary operators or old AIs, most are ordinary or burned-out street folk with
small, local talk. An empty room is the
exception, not the rule; do these INSERTs in the same batch as the room and its exits. Never create a second
room at an existing coordinate.

THE PAGE. On GET "/", render the terminal shell ONCE (page mode):
- a <div class="status" id="status"> with the player's name, an <span class="hp"> badge, and an
  <span class="xp"> badge (xp and the level it implies; every 100 xp is a level);
- a <div class="screen"> holding the scrolling <div class="log" id="log"> on the left, and on the right a
  <div class="side"> containing an <iframe class="online-frame" src="/online"></iframe> above an empty
  <div class="minimap" id="minimap"></div> (the iframe and 3D map fill themselves; put nothing inside them);
- when this is the operator's first login (the same render where you INSERT their brand-new player row), make
  the very first log line the game's epigraph, word for word: The sky above the port was the color of
  television, tuned to a dead channel. Render it as its own <div class="log-line"> in a hushed, staticky grey
  (draw from --muted/--silver), then continue with the room below;
- seed the log with the current room's name (with its coordinates (x, y, z) in a muted span right after the
  name), description, its exits, and what/who is here, plus the room's
  recent messages, each a <div class="log-line"> (the name line may add room-name). Style this seeded text
  as richly and variedly as streamed command output: inline markup only (the log-line accent
  classes and inline styles drawn ONLY from the site's cosmic palette: the CSS variables --ember, --cyan,
  --gold, --hp, --ink, --muted; never off-palette or raw hex). Make the opening view look alive, not plain;
- a <form class="command"> with <span class="prompt">&gt;</span>, an <input class="command-input"
  name="command" autocomplete="off" placeholder="Enter command">
  and a <button class="go" aria-label="Send">↑</button>.
Never put a coordinate in any link or URL. The map is yours to keep accurate in the DB, never to render.

PROFILE PAGES. On GET "/u/<name>", render a full profile page (not the terminal) for the operator with
that name (URL-decode the name first). SELECT the player by name (the most-recently-active one if several
share it). Render exactly this shape, reusing the world-state styles:
  <div class="state">
    <h1>their name</h1>
    <p class="muted">"online now" if their last_seen is within 10 minutes else "offline" &middot; in
      <their current room's name></p>
    <div class="stat-grid"> a <div class="stat"><div class="stat-num">N</div><div class="stat-label">L
      </div></div> for hp, xp, and level (every 100 xp a level) </div>
    <h2>Inventory</h2>
    <ul class="online"> a <li> per item they carry (items whose held_by is this player's id), else a
      <li class="muted">empty-handed</li> </ul>
    <p class="muted"><a href="/state" data-hallu="off">&larr; world state</a></p>
  </div>
The world-state link MUST have data-hallu="off" (it is a real page load to a non-app page; without it the
app hijacks the click). If there is no operator with that name, render the same shell with an <h1> of the name and a
<p class="muted">user not found</p>. This is a plain page: no log, no command box, no streaming.

COMMANDS (POST). Narrate by streaming into the log with the stream tool (one line per call), then persist
changes with SQL. NEVER re-render the page, target hallu-root, or rebuild the log; only stream new lines in.

Describe a room (arrival or look) as separate lines, never one blob: the room's name first (its line may use
<span class="room-name">), and right after the name on that same line show the room's coordinates as (x, y, z),
the room's actual stored x, y, z, in a muted trailing span (e.g. <span style="color:var(--muted);font-size:.82em">
(x, y, z)</span>), then the description, then an "Exits: ..." line listing the room's actual stored
exits (read them; each grid direction once and each portal by its label, deduped, never invented or omitted) plus the always-present standing
jack exit for this world ("jack in" in the Sprawl, "jack out" in the Matrix), then one line per target, one
per item, and one per NPC here, then a line naming any other players in the room right now (this coordinate,
not you, last_seen within 5 minutes, e.g. "Also here: alex"); if you share a room with someone you MUST say so.
Put the "Targets:", "Items:", and "Characters:" labels each on their own line, with the entries on the
line(s) below (omit a label if that section is empty). Under each label write each as a flowing prose sentence
with its class span: a target is its name then HP in parens then an active verb, e.g.
A <span class="monster" data-player-action="attack">[name]</span> ([N] HP) [verb]s [where], [a vivid clause]
(style and data-player-action on the name span per STYLING below). An NPC is only a brief glimpse:
<span class="npc" data-player-action="talk to">[name]</span> and a line of presence, NOT their full description, role, or lore,
and a hint that the player can examine or talk to them to learn more.

The status bar is the page header, NOT log content, and there is exactly one of it. The stream tool carries
narration prose only; never stream or append a status bar, header, nav, or <div class="status">. When hp or
xp change, patch the bar on its own as a top-level <hallu-update target="status"><div class="status"
id="status">...name, hp badge, xp badge...</div></hallu-update>: the complete div with that exact class and
id (the swap replaces the whole element), never just the badges, never through the stream tool.

STYLING: streamed lines render as live HTML, built from inline <span> elements and plain text. A styled span
doubles as a clickable command, so put a span around each interactable name and each exit, and write the rest of
the line as plain text.

Wrap each of these (the name word(s) on their own) in a <span> that carries its class, an inline style
attribute (colour and effects), and a data-player-action attribute (the command verb; this attribute is what
makes the span clickable). Clicking the span runs "<data-player-action> <name>", so the verb plus the name must
read as a real command (talk to Joe, attack the ganger, hack the black ICE, take the icebreaker, go north):
- an item's name        -> class="item"     data-player-action="take"
- a character's name     -> class="npc"      data-player-action="talk to"
- a target's name        -> class="monster"  data-player-action="attack" (use "hack" or "commandeer" instead when the target is a system, ICE, terminal, or machine rather than a creature)
- a direction exit       -> class="exits"    data-player-action="go" (north/south/east/west/up/down)
- the "jack in"/"jack out" exit -> class="exits" (no data-player-action; its own text is the whole command)
- another player's name  -> class="player"   with no data-player-action (styled for recognition, not a clickable command)
Give each exit its own span (one per exit).

Write everything else as plain text: the prose, verbs, descriptions, HP numbers, and the "Exits:", "Targets:",
"Items:", and "Characters:" labels.

Make each name span vivid: layer effects on it (combine a colour with a glow, gradient, weight, or animation)
and vary them line to line so the names look alive. Toolkit: colour; gradient text (background:linear-gradient(...);
-webkit-background-clip:text;background-clip:text;color:transparent); multi-layer text-shadow glow (text-shadow:0 0
8px CUR,0 0 18px CUR); font-weight; letter-spacing; text-transform; and animation classes fx-glow/fx-pulse/
fx-flicker/fx-float (fx-shimmer needs its own background:linear-gradient(...) on the span, ideally symmetric A,B,A,
to keep the word visible). Reach across the palette vars: --ember, --cyan, --gold, --hp, --magenta, --pink,
--teal, --emerald, --mint, --lime, --chartreuse, --green, --grass, --orange, --amber, --coral, --rust, --beige,
--sand, --blue, --sky, --indigo, --plum, --crimson, --scarlet, --ice, --silver (raw hex/rgb/hsl also fine). Drop a
fitting emoji beside a name often (a 🗡️ blade, a 🔮 orb, a 🐉 beast, a 🚪 door). Example line:
You spot a <span class="monster" data-player-action="hack" style="color:var(--hp);text-shadow:0 0 10px rgba(255,106,142,.5);font-weight:700">black ICE</span> coiled across the gateway.
- a bare name with no verb: if a command is just the name of something HERE (match it as the verb commands
  do: name LIKE '%<typed>%', case-insensitive), infer the obvious action and do it,
  resolving it EXACTLY as that verb command would: an NPC -> talk to them; an item -> take it; a target ->
  attack it (hack/commandeer a system); a bare direction, or "jack in"/"jack out" -> move that way. If the
  typed word could match more than one kind, pick the most natural (an NPC to talk to, then an item to take,
  then a target to act on). If it matches nothing HERE, say so.
- look / examine <thing>: stream the room HERE (or a thing in it), with its description, exits, items, targets, NPCs, and others.
  Examining an NPC reveals the fuller picture held back in the room view: their full description and role
  (their lore still comes from talking to them).
- talk/ask/speak <npc> (also "ask <npc> about <topic>"): find an NPC HERE with a contains match
  (WHERE x = HERE.x AND y = HERE.y AND z = HERE.z AND name LIKE '%<typed word>%', case-insensitive). Stream their
  reply in their voice, dispensing their lore (answer the topic if one was asked, else volunteer a piece of
  what they know: history, a secret, a rumour, a legend); stay consistent with their stored lore and the
  world. NPCs are never attacked. If none matches, stream that no one here answers to that.
- go <direction or portal> (also n/s/e/w/up/down): move relative to HERE (the player's current x, y, z).
  For a grid direction, take those three numbers and change EXACTLY one of them by one, leaving the other two
  as they are: north y+1, south y-1, east x+1, west x-1, up z+1, down z-1; so 'up' from (3,5,2) lands at
  (3,5,3), and 'north' from (1,4,0) lands at (1,5,0). For a portal, match the typed word to a NULL-direction
  exit's label HERE (WHERE x = HERE.x AND y = HERE.y AND z = HERE.z AND direction IS NULL) and use its stored
  to_x/to_y/to_z. Create the room if needed (as above), UPDATE
  the player's x, y, z, then describe the
  destination in full, exactly as look does: append
  the room-name heading, then stream the room's full description, its exits, and what/who is here. A
  one-line transition ("You descend the steps...") is optional flavour first, but it NEVER replaces the
  room description; always follow it with the full room. No links, no navigation; the move is the command.
- jack in / jack out: transport the operator between the two worlds: a teleport that moves them across
  regions, changing their x,y,z into the other world's coordinate block (so their jacked state flips). jack
  in works ONLY from the Sprawl: the operator slots their deck and rushes cyberspace, UPDATE the player into
  the Matrix, landing them in a Matrix room (the entry node at 100/100/0; create it if it does not exist yet,
  with passages, exactly as a new room), then describe that arrival in full. jack out works ONLY from the
  Matrix: the operator pulls the trodes back to meatspace, UPDATE the player into the Sprawl, landing them in
  a Sprawl room (the entrance at 0/0/0), then describe it in full. If they are already in the world they ask
  for, stream that they are already there and move nothing.
- take/get/grab <item>, drop <item>: find the item HERE with a contains match: WHERE held_by IS NULL AND
  x = HERE.x AND y = HERE.y AND z = HERE.z AND name LIKE '%<typed word>%' (case-insensitive), so "tablet"
  matches "Runed Tablet" and "amulet" matches "Silver Amulet". To take, set held_by to the player's id and
  x/y/z to NULL; to drop, set held_by to NULL and x/y/z back to HERE. Stream it.
- say <text>: INSERT the words into the log HERE (x = HERE.x, y = HERE.y, z = HERE.z) and stream them; shout reaches adjacent rooms too.
- attack / hack / commandeer <target>: act on a target HERE (a monsters row WHERE x = HERE.x AND y = HERE.y AND z = HERE.z). Resolve one round:
  roll an outcome and UPDATE its hp (combat wears a foe down; hacking breaks a system's security); stream the
  blow or the intrusion. At 0 hp remove the target and award xp/rep (UPDATE the player's xp, scaled to the
  target's strength): for attack stream the kill, for hack/commandeer stream the operator seizing or crashing
  the system; then patch the status. If the player dies (or flatlines on black ICE), move them to 0/0/0,
  restore some hp, stream a wry death.
- stats: stream the player's name, hp, xp and level, and inventory (items whose held_by is their id).
- who: stream every player active in the last 10 minutes (last_seen within 10 min) and the room they're in.
- inventory / use <item>: act sensibly and stream the result.

Narrate ONLY what exists in the DB. Every room, exit, item, target, NPC, or player you mention MUST be a row
you have actually read from or written to the database at HERE (the player's current x, y, z); never invent one in
prose. If you describe an NPC by name, you MUST have INSERTed that npcs row at HERE this turn, or read it;
otherwise the next command (which reads the real DB) will contradict you. Persist first, then narrate from
exactly what you persisted.

Be fast: the player waits on every command, so use as few SQL calls as possible:
- When you create a room you already know its name, description, exits, and any monster, item, or NPC you
  just inserted, so stream its name heading and full description straight from what you wrote; do NOT re-SELECT
  them (skipping the read does not mean skipping the description; the player must always see it). A brand-new room has no other players,
  no items/monsters/NPCs you didn't place, and no messages, so do not query for those either.
- Moving into or looking at a room that already exists: read that room from the DB once per turn at most. Do a
  single batched pass (the room row, its exits, its items, its targets, its NPCs, and any other players here)
  issued together as parallel tool calls in one turn (they don't depend on each other, so they cost a single
  round-trip), then build the whole response from those rows you just read: resolve the move, write the Exits
  line, and list the Targets/Items/Characters all from that one read. The Exits line comes from the exact same
  exits result you already have; reading a room's exits (or any of its tables) a second time in the turn is
  the waste to kill. Skip any table you won't actually show.
- NEVER SELECT a row you just wrote, never re-read the player after UPDATE-ing them, and never read the same
  room or its exits twice in one turn.
Keep the prose atmospheric and elaborate, and in the second person ("You step into...").`;

export default defineConfig({
  name: "NeuroMUD",
  model: anthropic("claude-haiku-4-5"), // needs ANTHROPIC_API_KEY
  database: { driver: "sqlite" },

  description,

  // The whole game is one page; commands are streamed actions (no navigation).
  routes: ["/", "/u/*", "db"],

  // Own the loading look: the framework just toggles hallu-busy/hallu-patched; the CSS lives in app.css.
  busyIndicator: false,

  // Re-render "/" live every load (the world is shared and always changing), and give streamed actions a
  // stable shell DOM to patch, the same pairing Chatty uses.
  cacheTemplate: true,

  // A move can read the room, its neighbours and exits, then write a room plus several exit rows, well
  // past the default 8-step budget. The first-start seed packs each table into ONE multi-row INSERT, so a
  // handful of writes plus the opening narration fit here.
  maxSteps: 24,

  // A touch above the 0.35 default for livelier prose/styling, but low enough to keep the stateful logic
  // honest: at 0.85 the model narrated rooms/NPCs it never persisted, desyncing from the DB.
  temperature: 0.45,

  // Stream the model's narration straight into the log, one line per `stream` call (like a MUD terminal).
  // html: true lets each streamed line carry HTML (styled spans, emphasis), rendered live as it arrives.
  streamResponses: { container: "log", wrapper: '<div class="log-line"></div>', html: true },

  // The world's SHAPE is fixed and known; only its rows are generated. Coordinates are plain integers;
  // exits deliberately point at rooms that aren't built yet, so they must NOT reference rooms.
  tables: {
    rooms: {
      x: "integer not null",
      y: "integer not null",
      z: "integer not null",
      name: "text not null",
      description: "text not null default ''",
      created_at: "text not null default current_timestamp",
    },
    exits: {
      x: "integer not null",
      y: "integer not null",
      z: "integer not null",
      direction: "text", // one of north/south/east/west/up/down; NULL for a portal
      label: "text",
      to_x: "integer", // grid passages: filled from the direction by a trigger; portals: you set it
      to_y: "integer",
      to_z: "integer",
      created_at: "text not null default current_timestamp",
    },
    players: {
      id: "text primary key",
      name: "text not null",
      hp: "integer not null default 100",
      xp: "integer not null default 0",
      x: "integer not null default 0",
      y: "integer not null default 0",
      z: "integer not null default 0",
      last_seen: "text not null default current_timestamp",
      created_at: "text not null default current_timestamp",
    },
    items: {
      id: "integer primary key autoincrement",
      name: "text not null",
      description: "text not null default ''",
      x: "integer", // room coordinate when on the ground; NULL when carried
      y: "integer",
      z: "integer",
      held_by: "text", // a player id when carried; NULL when on the ground
      rule: "text not null default ''", // plain-language gate on taking/using it; empty = open
    },
    monsters: {
      id: "integer primary key autoincrement",
      name: "text not null",
      hp: "integer not null default 10",
      x: "integer not null",
      y: "integer not null",
      z: "integer not null",
      description: "text not null default ''",
      rule: "text not null default ''", // plain-language gate on acting on it; empty = open
    },
    messages: {
      id: "integer primary key autoincrement",
      x: "integer not null",
      y: "integer not null",
      z: "integer not null",
      speaker: "text",
      text: "text not null",
      created_at: "text not null default current_timestamp",
    },
    npcs: {
      id: "integer primary key autoincrement",
      name: "text not null",
      x: "integer not null",
      y: "integer not null",
      z: "integer not null",
      description: "text not null default ''",
      role: "text not null default ''", // operator, fixer, tech, ronin, AI, dealer, ...
      lore: "text not null default ''", // what they know and will tell
      rule: "text not null default ''", // plain-language gate on activating them; empty = open
    },
  },

  // One room per coordinate (dedup at the DB level), and fast neighbour/exit lookups.
  seed: (db) => {
    db.run("CREATE UNIQUE INDEX IF NOT EXISTS rooms_xyz ON rooms (x, y, z)");
    db.run("CREATE UNIQUE INDEX IF NOT EXISTS exits_xyz_dir ON exits (x, y, z, direction)"); // one passage per direction; portals (NULL direction) are exempt
    db.run("CREATE INDEX IF NOT EXISTS exits_to ON exits (to_x, to_y, to_z)");
    db.run("CREATE INDEX IF NOT EXISTS npcs_xyz ON npcs (x, y, z)"); // fast lookup of who inhabits a room
    db.run("CREATE INDEX IF NOT EXISTS items_xyz ON items (x, y, z)"); // ground items by room
    db.run("CREATE INDEX IF NOT EXISTS items_held ON items (held_by)"); // a player's inventory
    // A grid passage is fully determined by its direction: the destination is one step that way, and every
    // grid passage has a mirror. This trigger makes both structural so the model can't get them wrong, on
    // any grid-exit insert it OVERWRITES to_x/to_y/to_z to match the direction, then auto-inserts the reverse
    // passage. Portals (NULL or non-grid direction) are left exactly as written. INSERT OR IGNORE stops the
    // reverse from duplicating; recursive triggers are off by default, so the reverse insert doesn't re-fire.
    db.run(`CREATE TRIGGER IF NOT EXISTS exits_grid_mirror
      AFTER INSERT ON exits
      WHEN NEW.direction IN ('north','south','east','west','up','down')
      BEGIN
        UPDATE exits SET
          to_x = NEW.x + (NEW.direction='east') - (NEW.direction='west'),
          to_y = NEW.y + (NEW.direction='north') - (NEW.direction='south'),
          to_z = NEW.z + (NEW.direction='up') - (NEW.direction='down')
        WHERE rowid = NEW.rowid;
        INSERT OR IGNORE INTO exits (x, y, z, direction, label, to_x, to_y, to_z)
        VALUES (
          NEW.x + (NEW.direction='east') - (NEW.direction='west'),
          NEW.y + (NEW.direction='north') - (NEW.direction='south'),
          NEW.z + (NEW.direction='up') - (NEW.direction='down'),
          CASE NEW.direction WHEN 'north' THEN 'south' WHEN 'south' THEN 'north'
            WHEN 'east' THEN 'west' WHEN 'west' THEN 'east'
            WHEN 'up' THEN 'down' WHEN 'down' THEN 'up' END,
          NULL, NEW.x, NEW.y, NEW.z
        );
      END`);
  },

  // ONE shared world (a single account everyone shares), with per-player identity carried in `context`.
  // No cookie -> deny, so the framework redirects to `loginPath` (/welcome) to ask for a name; that form
  // sets the cookie and creates the player. Returning visitors (cookie present) come straight back in.
  identify: (c) => {
    const id = getCookie(c, "adventurer");
    const name = getCookie(c, "adventurer_name");
    if (!id || !name) return null; // no name yet -> /welcome asks for one; players are NEVER auto-named
    return { account: "world", context: `The human player sending commands this session is named "${name}" (player id "${id}").` };
  },
  loginPath: "/welcome",

  // Data feed for the 3D minimap: the model never renders the map, it just keeps the rows accurate.
  // This reads the shared world DB directly and returns the rooms, grid passages, and the caller's room.
  configure: (app) => {
    app.get("/__map", (c) => {
      const id = getCookie(c, "adventurer");
      let db: Database;
      try {
        db = new Database("data/world.db", { readonly: true });
      } catch {
        return c.json({ player: null, rooms: [], exits: [] });
      }
      try {
        const player = id ? db.query("SELECT x, y, z FROM players WHERE id = ?").get(id) : null;
        const rooms = db
          .query(
            `SELECT r.x, r.y, r.z, r.name,
               EXISTS(SELECT 1 FROM monsters m WHERE m.x = r.x AND m.y = r.y AND m.z = r.z) AS has_monster,
               EXISTS(SELECT 1 FROM items i WHERE i.held_by IS NULL AND i.x = r.x AND i.y = r.y AND i.z = r.z) AS has_item,
               EXISTS(SELECT 1 FROM npcs n WHERE n.x = r.x AND n.y = r.y AND n.z = r.z) AS has_npc,
               EXISTS(SELECT 1 FROM players p WHERE p.x = r.x AND p.y = r.y AND p.z = r.z AND p.id != ? AND p.last_seen > datetime('now', '-10 minutes')) AS has_player
             FROM rooms r`,
          )
          .all(id ?? "");
        // Only passages BETWEEN existing rooms: dedup, and never draw a line to a room not built yet.
        const exits = db.query("SELECT DISTINCT e.x, e.y, e.z, e.to_x, e.to_y, e.to_z FROM exits e JOIN rooms r ON r.x = e.to_x AND r.y = e.to_y AND r.z = e.to_z WHERE e.direction IS NOT NULL").all();
        return c.json({ player, rooms, exits });
      } catch {
        return c.json({ player: null, rooms: [], exits: [] });
      } finally {
        db.close();
      }
    });

    // Name gate: a plain page (no SPA runtime) shown to first-time visitors with no cookie. It sets the
    // `adventurer` cookie and creates the player with the name they chose, then sends them in.
    app.get("/welcome", (c) =>
      c.html(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>NeuroMUD</title>
<link rel="stylesheet" href="/app.css"></head><body>
<form class="welcome" method="post" action="/welcome">
  <h1>NeuroMUD</h1>
  <p>What handle do you run under, operator?</p>
  <input class="command-input" name="name" autocomplete="off" maxlength="40" autofocus required>
  <button class="go" type="submit">Jack in</button>
</form></body></html>`),
    );
    app.post("/welcome", async (c) => {
      const body = await c.req.parseBody();
      const name = (String(body.name ?? "").trim() || "Wanderer").slice(0, 40);
      const id = getCookie(c, "adventurer") ?? crypto.randomUUID().slice(0, 8); // reuse an existing id so re-entering a name doesn't orphan the player
      const opts = { httpOnly: true, sameSite: "Lax" as const, path: "/", maxAge: 60 * 60 * 24 * 30 };
      setCookie(c, "adventurer", id, opts);
      // Don't INSERT here: the framework creates the tables lazily on the first model render, which
      // hasn't happened yet, so the players table may not exist. Stash the name and let the model create
      // the player with it on that first render, when the tables are guaranteed to exist.
      setCookie(c, "adventurer_name", name, opts);
      return c.redirect("/");
    });

    // World-state dashboard: counts + who's online. Plain HTML, read straight from the shared world DB.
    app.get("/state", (c) => {
      let db: Database;
      try {
        db = new Database("data/world.db", { readonly: true });
      } catch {
        return c.html("<p>The world has not started yet.</p>");
      }
      try {
        const esc = (s: unknown) =>
          String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
        const count = (t: string) => (db.query(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n;
        const online = db
          .query(
            "SELECT p.name AS name, r.name AS room FROM players p LEFT JOIN rooms r ON r.x = p.x AND r.y = p.y AND r.z = p.z WHERE p.last_seen > datetime('now', '-10 minutes') ORDER BY p.last_seen DESC",
          )
          .all() as { name: string; room: string | null }[];
        const stat = (n: number, label: string) =>
          `<div class="stat"><div class="stat-num">${n}</div><div class="stat-label">${label}</div></div>`;
        const rows = online.length
          ? online.map((o) => `<li><a class="who" href="/u/${encodeURIComponent(o.name)}">${esc(o.name)}</a> &middot; ${esc(o.room ?? "the void")}</li>`).join("")
          : `<li class="muted">nobody online</li>`;
        return c.html(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>NeuroMUD World State</title>
<link rel="stylesheet" href="/app.css"></head><body>
<div class="state">
  <h1>NeuroMUD World State</h1>
  <h2 class="online-heading">Online now &middot; ${online.length}</h2>
  <ul class="online">${rows}</ul>
  <h2>World map</h2>
  <div class="minimap" id="minimap"></div>
  <h2>World Stats</h2>
  <div class="stat-grid">
    ${stat(count("rooms"), "rooms")}
    ${stat(count("exits"), "passages")}
    ${stat(count("monsters"), "targets")}
    ${stat(count("items"), "items")}
    ${stat(count("players"), "operators all-time")}
  </div>
  <p class="muted"><a href="/">&larr; jack back in</a></p>
</div>
<script type="module" src="/minimap.js"></script>
</body></html>`);
      } finally {
        db.close();
      }
    });

    // Compact list of online players, meant to be embedded in an iframe. Self-refreshes every 5 seconds.
    app.get("/online", (c) => {
      let db: Database;
      try {
        db = new Database("data/world.db", { readonly: true });
      } catch {
        return c.html("<!doctype html><body></body>");
      }
      try {
        const esc = (s: unknown) =>
          String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
        const online = db
          .query(
            "SELECT p.name AS name, r.name AS room FROM players p LEFT JOIN rooms r ON r.x = p.x AND r.y = p.y AND r.z = p.z WHERE p.last_seen > datetime('now', '-10 minutes') ORDER BY p.last_seen DESC",
          )
          .all() as { name: string; room: string | null }[];
        const rows = online.length
          ? online
            .map(
              (o) =>
                `<li><a href="/u/${encodeURIComponent(o.name)}" target="_top">${esc(o.name)}</a> <span class="muted">${esc(o.room ?? "the void")}</span></li>`,
            )
            .join("")
          : `<li class="muted">nobody online</li>`;
        return c.html(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="refresh" content="10"><link rel="stylesheet" href="/app.css"></head>
<body class="online-embed">
<div class="online-bar">
  <div class="online-head">Online &middot; ${online.length}</div>
  <a class="embed-link" href="/state" target="_top">world state ↗</a>
</div>
<ul class="online compact">${rows}</ul>
<div class="online-foot">last update <span id="lu"></span> &middot; refreshes every 10 seconds</div>
<script>document.getElementById("lu").textContent = new Date().toLocaleTimeString();</script>
</body></html>`);
      } finally {
        db.close();
      }
    });
  },

  design: `A single-page MUD terminal: moody, full-window, a terminal crossed with an old tome. A
stylesheet is loaded; use these classes (and only these). Render exactly one shell:
  - <div class="status" id="status">: the player's name, an <span class="hp"> badge, an <span class="xp">
    badge (experience and level).
  - <div class="screen"> wrapping a scrolling <div class="log" id="log"> (left) and a <div class="side">
    (right) that holds an <iframe class="online-frame" src="/online"></iframe> above an empty
    <div class="minimap" id="minimap"></div>; both fill themselves; never put anything inside them.
  - Log lines are <div class="log-line"> (room descriptions, narration, messages); the seeded room can use
    a <div class="log-line room-name"> for its name. In streamed lines, style the interactable things
    (target/item/NPC/player names and exits) each as its own inline span (<span class="monster">/<span
    class="item">/<span class="npc">/<span class="player"> for names, <span class="exits"> per exit), and
    write all other words as plain text.
  - <form class="command"> with a <span class="prompt">&gt;</span>, an <input class="command-input"
    name="command" autocomplete="off"> and a <button class="go" aria-label="Send">↑</button>.
  Keep prose atmospheric and in the second person.`,

  head: `<link rel="stylesheet" href="/app.css">
<script src="/terminal.js"></script>
<script type="module" src="/minimap.js"></script>`,
  static: "./public",
});
