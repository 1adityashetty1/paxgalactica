# Phase 2 — Terminal to Browser: Subagent Prompt Series

Pax Galactica currently runs as an Ink TUI. Phase 2 moves the interface into a
browser on localhost while keeping the engine intact.

**This is a frontend swap, not a rewrite.** Roughly 62% of the source is
already platform-agnostic:

| Layer | Lines | Phase 2 status |
|---|---|---|
| `src/domain/` | 1,393 | **Reuse verbatim.** Pure, no I/O, no network, heavily tested. Do not modify. |
| `src/engine/` | 638 | **Reuse**, after lifting `node:fs` behind a storage interface. |
| `src/model/` | 939 | **Reuse, server-side only.** Spawns a binary and holds an OAuth token. |
| `src/seed/` | 302 | **Reuse verbatim.** |
| `src/ui/` | 1,684 | **Terminal-specific — replaced.** Some pure logic is portable; see Prompt 4. |

Each prompt below is self-contained. A subagent starts cold, so paste the
**Shared Preamble** at the top of every one.

---

## Dependency decisions — get user approval before Prompt 2

The project has been strict about dependencies. Phase 2 needs a decision on:

| Need | Recommendation | Alternative |
|---|---|---|
| Browser build/dev server | **Vite** (devDep) | esbuild directly; hand-rolled |
| HTTP server | **`node:http`, zero deps** | Fastify, Express, Hono |
| Server→browser streaming | **SSE, zero deps** | WebSocket (`ws` dep) |
| UI framework | **React** — already a dependency | Preact, Svelte, vanilla |

The recommended path adds exactly **one** new dependency (Vite) because React
is already installed for Ink and `node:http` + SSE covers streaming.

---

## Decided: the Ink TUI is retired

It adds **no validation value**, and this is worth stating plainly so nobody
resurrects it out of caution:

- **It cannot run headless.** `assertInteractiveTerminal` in `src/preflight.ts`
  aborts without a TTY, by design — Ink needs raw-mode stdin. So the TUI can
  never run in CI, and no agent can drive it to verify anything.
- **No test touches it.** All 160 tests hit `src/domain` and `src/engine`
  directly. The three UI test files (`map`, `braille`, `wrap`) cover pure
  functions that do not need Ink to exist.
- **It doubles the cost of every engine change**, since the contract, the
  briefing and the panels would all need porting twice.

Automated validation in Phase 2 comes from the existing domain/engine tests
plus server-handler tests (Prompt 2), both headless. That is strictly better
coverage than the TUI ever provided.

**Timing matters, though.** Do not delete it in Prompt 1, or there is a window
with nothing playable at all. It is removed in **Prompt 3**, the moment the
browser shell can load a campaign — the earliest point where nothing is lost.

### What survives from `src/ui/`

| File | Fate |
|---|---|
| `map.ts` | Layout maths extracted to `layout.ts` (Prompt 4) and reused; the character-grid renderer goes |
| `ansi256.ts` | **Keep.** `displayColor` is an ANSI 256 index and the browser needs hex |
| `briefing.ts` | Moves to `src/engine/` as structured data (Prompt 1) |
| `braille.ts` + `braille.test.ts` | Delete — terminal subpixel rendering has no browser analogue |
| `wrap.ts` + `wrap.test.ts` | Delete — CSS wraps text |
| `App.tsx`, `MapPane.tsx`, `SidePanel.tsx`, `FactionPicker.tsx`, `useTerminalSize.ts`, `src/play.tsx` | Delete |

`src/replay.ts` is a **CLI, not a TUI** — it needs no terminal and is the
primary determinism check. Keep it.

### What this simplifies

With no TUI to keep compiling, `CampaignStore` in Prompt 1 can be **async
throughout**. No sync/async duality, no second code path.

---

## Shared Preamble

> Paste this verbatim at the top of every Phase 2 subagent prompt.

```
You are working on Pax Galactica, an LLM-driven grand strategy game at
/Users/aditya/Documents/paxgalactica. Read CLAUDE.md first — it documents the
architecture, the op vocabulary, the duration rules, the ability-check system
and the prompt contract.

## Non-negotiable invariants

1. THE MODEL NEVER REWRITES STATE. Model calls return a narrative plus typed
   ops; `applyOps` in src/domain/reducer.ts is the only thing that mutates the
   world, and it is pure. Never let the browser, the server, or a model call
   assign world state directly.

2. `src/domain/` IS PURE AND OFF LIMITS. No I/O, no network, no imports from
   engine/model/ui. It has 160 passing tests. If you think you need to change
   it, you are probably solving the problem in the wrong layer — say so instead.

3. DETERMINISM IS TESTED. Replay must rebuild any campaign from its ops journal
   with zero model calls and produce byte-identical state. That depends on:
   order ids derived from turn+sequence, BFS visiting neighbours in sorted
   order, arrival combat being arithmetic, and dice coming from
   `rollD20(turn, salt)` (an FNV-1a hash) rather than Math.random(). Never
   introduce a clock or an RNG into anything the journal replays.

4. SECRETS STAY ON THE SERVER. `src/model/` spawns a Claude Code binary and
   injects a subscription OAuth token read from ~/.paxgalactica/oauth-token.
   That token must NEVER be sent to the browser, embedded in client-side
   JavaScript, or written into any file the browser can fetch. All model calls
   happen server-side.

5. BIND TO 127.0.0.1 ONLY. The server can spend real money on model calls.
   It must not listen on 0.0.0.0 or any LAN-reachable interface.

## Environment and known traps

- macOS. Node 24. pnpm 11 via corepack (`corepack enable pnpm` if missing).
- TypeScript 7, `module: nodenext`, `jsx: react-jsx`, strict, and
  `noUncheckedIndexedAccess` is ON — indexed reads are `T | undefined`.
- There is NO ts runner (no tsx/ts-node). `pnpm play` is `tsc && node dist/...`.
  Keep it that way unless the user approves a new dependency.
- `structuredClone` is NOT typed by @types/node v26 here. The reducer uses a
  JSON round-trip deliberately.
- Zod 4. Use `z.toJSONSchema(schema, { target: 'draft-7', io: 'input' })` —
  `io: 'input'` makes fields with defaults optional, which is what a model
  emitting the object needs.
- Model calls take 5–15 seconds. Any UI must show progress and never block on
  them synchronously.
- `maxTurns` in src/model/router.ts is 6, NOT 1, and must stay above 1: under
  `outputFormat: json_schema` the SDK returns results through an end-turn tool
  that costs its own agentic round trip.
- The test suite sets `PAXGALACTICA_NO_NETWORK=1` and the model client throws
  if a call is attempted under it. Never mock around this; never let a test
  reach the network.
- `pnpm token` is a RESERVED pnpm command. The script is `pnpm save-token`.
- Verify auth with `pnpm auth` (it makes one real Haiku call). If it fails,
  STOP and tell the user — do not attempt to authenticate on their behalf.

## Definition of done for every prompt

- `pnpm typecheck` clean.
- `pnpm test` fully green (currently 160 tests). Never delete a test to make it
  pass; if a test is genuinely obsolete, say why in your report.
- New logic covered by new tests, including failure paths.
- Report honestly what you did NOT verify.
```

---

## Prompt 1 — Platform-agnostic core and the API contract

**Run first. Everything else depends on it. Do not parallelise.**

```
[SHARED PREAMBLE]

## Goal

Make the engine usable from a web server without changing its behaviour, and
define the client/server contract as shared Zod schemas.

## Task

1. Lift filesystem access out of `src/engine/campaign.ts` behind an interface:

   ```ts
   export interface CampaignStore {
     load(name: string): Promise<SaveFile | null>;
     save(name: string, data: SaveFile): Promise<void>;
     list(): Promise<string[]>;
     exists(name: string): Promise<boolean>;
   }
   ```

   Provide `FileCampaignStore` (current behaviour, saves/<name>.json) and
   `MemoryCampaignStore` (for tests). Campaign takes a store rather than calling
   node:fs itself.

   Make it **async throughout** — no sync variants. The Ink TUI is being retired
   in Prompt 3, so there is no caller that needs the synchronous path, and a
   sync/async duality here would be permanent complexity for a frontend that is
   about to be deleted. Update `src/play.tsx` minimally to keep it compiling
   until Prompt 3 removes it; do not invest in it.

2. Create `src/api/contract.ts`: Zod schemas for every client/server message.
   At minimum:
   - `GET  /api/campaign`            -> full WorldState + staged summary
   - `POST /api/campaign/new`        -> { factionId } -> WorldState
   - `POST /api/action`              -> { text } -> ActionOutcome (narrative,
                                        check, staged count, rejections)
   - `POST /api/endturn`             -> TurnOutcome (applied, reactions, report)
   - `POST /api/staged/discard`      -> ok
   - `GET  /api/factions`            -> playable factions for the picker
   - `POST /api/talk/:factionId`     -> { text } -> { reply }
   - `POST /api/endtalk/:factionId`  -> ActionOutcome (extraction)
   - `GET  /api/events`              -> SSE stream for progress + state pushes

   Derive request/response types from the schemas; do not hand-write parallel
   interfaces. Reuse existing domain schemas by import — do not duplicate them.

3. Move `src/ui/briefing.ts` to `src/engine/briefing.ts` and change it to return
   **structured items rather than styled lines**. It currently emits
   `{ text, color, dim, bold }` shaped for a terminal feed; the browser wants
   the underlying data (treasury, net income, completions, in-progress work with
   ETA, observable enemy projects) and will decide its own presentation.

## Do NOT

- Touch `src/domain/`.
- Write any HTTP server yet.
- Change game rules, durations, stats, or prompts.

## Acceptance

- `pnpm test` green; add tests for `MemoryCampaignStore` and for the contract
  schemas round-tripping a real WorldState.
- `pnpm replay` still rebuilds a saved campaign byte-identically.
- `pnpm play` still compiles and runs — it is the only playable surface until
  Prompt 3, so do not break it, but do not improve it either.
- A short doc comment in contract.ts explaining why the contract is Zod-first.
```

---

## Prompt 2 — Localhost HTTP server

**Depends on Prompt 1.**

```
[SHARED PREAMBLE]

## Goal

A zero-dependency `node:http` server on 127.0.0.1 that exposes the engine over
the Prompt 1 contract, holds campaign state in memory, and streams progress.

## Task

1. `src/server/index.ts` — an http server bound to **127.0.0.1** (never
   0.0.0.0), default port 4173, overridable with PAXGALACTICA_PORT.

2. Run the existing preflight (src/preflight.ts) at startup, minus the TTY
   check, which does not apply to a server. If auth is missing, exit with the
   same clear message rather than starting and failing on the first action.

3. One campaign per server process is acceptable for v1 — this is a
   single-player local game. Keep a `Campaign` instance in module state. Say so
   explicitly in a comment so nobody mistakes it for multi-tenant.

4. Every route validates its body with the contract schema and returns a
   structured error on failure. Never trust the client.

5. SSE endpoint `/api/events` pushing:
   - `{ type: 'progress', label }` when a model call starts/finishes, because
     these take 5–15 seconds and the browser must show something
   - `{ type: 'state', state }` after any state change
   - `{ type: 'error', message }`

   Model calls must not block the event loop for other requests.

6. Serve the built browser client as static files from `dist/web` when present,
   so `pnpm play:web` is one command and one URL.

7. Concurrency guard: reject a second action while one is in flight, with a
   clear 409. The staging model assumes ordered declarations.

## Do NOT

- Add a server framework unless the user approved one.
- Expose the OAuth token, the token path, or raw `process.env` on any route.
- Add auth/login to the web app — it is localhost, single user.

## Acceptance

- `pnpm test` green, plus tests that hit route handlers directly (extract
  handlers as pure functions taking parsed input so they are testable without
  binding a port).
- Manual: start it, `curl localhost:4173/api/campaign` returns valid state.
- Confirm with `lsof -nP -iTCP:4173 | grep LISTEN` that it is bound to
  127.0.0.1 and not *.
```

---

## Prompt 3 — Browser client shell

**Depends on Prompt 2. Can run in parallel with Prompt 4.**

```
[SHARED PREAMBLE]

## Goal

A React + Vite app in `web/` that connects to the server, shows the campaign,
and handles the async nature of model calls without feeling broken.

## Task

1. Vite + React + TypeScript in `web/`, building to `dist/web`. Share types
   with the server by importing from `src/api/contract.ts` — configure paths so
   there is ONE definition of the contract, not a copy.

2. Scripts: `pnpm dev:web` (Vite dev server, proxying /api to 4173) and
   `pnpm play:web` (build client, start server, open the browser on macOS via
   `open`).

3. Layout: map area, side panel, message feed, command input — the same
   information architecture as the TUI, which is proven. Do not redesign the
   game while porting it.

4. State: fetch initial campaign, then apply SSE pushes. Show a clear busy
   state during model calls with the server-sent label ("Resolving…",
   "Meridian considers…"). A 10-second silent spinner is the main way this port
   can feel worse than the terminal — make the wait legible.

5. Faction picker on first load when no campaign exists.

6. Keyboard parity where it makes sense: Enter submits, and the command line
   accepts the same `:`/`/` commands. Free text is still the default action
   input.

7. **Retire the Ink TUI — but only once step 1–6 above actually work.** This is
   the first moment nothing is lost by removing it.

   Delete: `src/play.tsx`, `src/ui/App.tsx`, `src/ui/MapPane.tsx`,
   `src/ui/SidePanel.tsx`, `src/ui/FactionPicker.tsx`,
   `src/ui/useTerminalSize.ts`, `src/ui/braille.ts`, `src/ui/wrap.ts`, and the
   tests `tests/braille.test.ts`, `tests/wrap.test.ts`.

   Keep: `src/ui/ansi256.ts` (faction colours are ANSI 256 indices and the
   browser needs hex — it has tests, keep them), `src/replay.ts` (a CLI, not a
   TUI, and the primary determinism check), and `src/ui/map.ts` if Prompt 4 has
   not yet extracted its layout maths — coordinate with that work rather than
   deleting logic it is mid-way through moving.

   Remove `ink` and the `play` script. Drop the TTY check from preflight, since
   nothing needs a terminal any more; keep the auth and API-key checks. Confirm
   `react` is still required (the browser client uses it) before touching it.

   Removing `braille.test.ts` and `wrap.test.ts` deletes ~149 lines of passing
   tests. That is correct here — they cover terminal-only rendering with no
   browser analogue — and it is the one sanctioned exception to "never delete a
   test". Say so explicitly in your report, with the new total.

## Do NOT

- Reimplement game logic in the browser. The client renders state and posts
  intents; the server owns the engine.
- Add a state management library without asking. React state is enough here.
- Add CSS frameworks without asking.
- Delete the TUI before the browser can load a campaign, declare an action and
  end a turn. If you cannot get there, leave it in place and report why.

## Acceptance

- `pnpm play:web` opens a working game in the browser on macOS.
- Declaring an action, ending a turn, and opening a diplomatic channel all work.
- Killing the server mid-call surfaces an error rather than hanging forever.
- After removal: `pnpm typecheck` clean, `pnpm test` green, no dangling imports
  of deleted modules, and `pnpm replay` still works.
```

---

## Prompt 4 — Browser map renderer

**Depends on Prompt 1. Can run in parallel with Prompt 3.**

```
[SHARED PREAMBLE]

## Goal

Replace the Braille/character map with a proper vector map, reusing the layout
logic that already works.

## Context

`src/ui/map.ts` (451 lines) contains two separable things:

- **Portable:** coordinate fitting, the MAX_STRETCH aspect-ratio cap, label
  collision and priority (high strategicValue claims space first), sector
  zooming, `nextSystemInDirection` cursor logic. This logic is tested and worth
  keeping.
- **Terminal-only:** the Braille subpixel canvas (`src/ui/braille.ts`), ANSI 256
  colour conversion, and character-cell compositing.

## Task

1. Extract the portable layout maths into `src/ui/layout.ts`, returning
   positions in **normalised coordinates** (0–1) rather than character cells, so
   the consumer decides pixels.

   The Ink TUI is being deleted in Prompt 3, so do not preserve the
   character-grid renderer or build a compatibility shim for it. Extract the
   maths, port the tests that still mean something, and drop the rest. If
   Prompt 3 has already run, `map.ts` may be all that is left in `src/ui/`
   besides `ansi256.ts` — that is expected.

2. Build an **SVG** renderer in the browser. SVG over Canvas because it gives
   crisp scaling, trivial hit-testing for click-to-select, and CSS hover states
   for free. Reconsider only if profiling shows a problem — 25 systems will not.

3. Render: hyperlanes as lines (faction-coloured when both endpoints share a
   controller, grey otherwise — the existing rule), systems as glyphs coloured
   by controller, contested systems marked, fleets in transit positioned along
   their path by progress, and labels that no longer need suppression because
   SVG has real text layout.

4. Interaction the terminal could not do: click to select, hover for a tooltip,
   scroll/pinch zoom, drag to pan, and a visible ETA on in-transit fleets.

5. Faction colours: `displayColor` is an ANSI 256 index. `src/ui/ansi256.ts`
   already converts to hex — reuse it rather than inventing a second palette.

## Do NOT

- Change system coordinates or the seed scenario.
- Add a charting/graph library — this is ~25 nodes and ~40 edges.
- Carry the character-grid renderer forward "just in case".

## Acceptance

- All 25 systems and every hyperlane render, correctly coloured.
- Clicking a system selects it and updates the side panel.
- New tests for `layout.ts` covering the invariants worth keeping from
  `map.test.ts`: every system placed, nothing positioned outside bounds, the
  aspect-ratio cap applied to a nearly-collinear sector (the Ilvenn Fringe is
  the case that broke this before), and sector zoom including only that
  sector's systems. Label-collision and Braille tests do not survive the port —
  say which you dropped and why.
```

---

## Prompt 5 — Panels, diplomacy, and the turn briefing

**Depends on Prompts 2 and 3.**

```
[SHARED PREAMBLE]

## Goal

Port the informational surfaces, and use the browser to fix the things the
terminal made awkward.

## Task

1. **Panels** (`[F]`actions / `[S]`ystem / `[O]`rders / `[L]`og in the TUI):
   - Factions: colour swatch, disposition, fleet, credits, the five stats,
     war/trade ethic, doctrine. Stats should be visually comparable at a
     glance — a bar or dot row beats five numbers.
   - System: controller, garrison, strategic value, hyperlanes as clickable
     links, orders touching it.
   - Orders: progress bars with ETA. This is where multi-turn work lives.
   - Log: the full event log, filterable by kind. `rejection` and `clamp`
     entries are debugging gold — make them filterable, not hidden.

2. **Turn briefing.** The TUI prints it to the feed on every `:endturn`. In the
   browser it should be a persistent panel that is always current: treasury and
   net income, what completed, what is under way with ETA, what completes next
   turn, and observable enemy projects. The whole point is that the player
   never has to go looking.

3. **Diplomacy.** A proper chat view per faction, in the faction's colour, with
   history. Make the boundary visible in the UI: nothing said in a channel
   changes the world until `/endtalk` runs the extraction pass. Show staged
   agreements distinctly from committed ones.

4. **Staged actions.** The staging model (declare now, lands on `:endturn`) is
   hard to see in a terminal. Show a clear list of what is declared but not yet
   landed, with per-item discard.

5. **Ability checks.** When an action resolves, show the roll: stat, d20,
   modifier, DC, and outcome band. It is a dice game — let the player see the
   dice.

## Do NOT

- Change the staging semantics or the diplomacy boundary. They are load-bearing
  and documented in CLAUDE.md.
- Show the player information their faction should not have. `ordersVisibleTo`
  exists for a reason; hidden enemy projects must stay hidden.

## Acceptance

- Every piece of information available in the TUI is available in the browser.
- A ten-turn campaign is playable start to finish without reading the terminal.
```

---

## Prompt 6 — Parity, packaging, and documentation

**Run last.**

```
[SHARED PREAMBLE]

## Goal

Prove the browser build is a faithful port, make it one command on macOS, and
document it.

## Task

1. **Replay parity.** Play a campaign in the browser, save it, and confirm
   `pnpm replay` rebuilds byte-identical state with zero model calls. This is
   the strongest evidence the port did not corrupt the engine. Add a test that
   drives the server's own handlers through several turns and asserts
   `verifyReplay()`.

2. **One command.** `pnpm play:web` should: check auth, build if stale, start
   the server on 127.0.0.1, and `open` the browser. Failure at any step should
   explain itself the way the current preflight does.

3. **Graceful shutdown.** Ctrl-C saves the campaign before exiting. Staged (not
   yet landed) actions are not journaled and will be lost — warn, as `:quit`
   does today.

4. **Update CLAUDE.md.** Replace the whole TUI section — Ink, Braille subpixel
   rendering, label suppression, the command table, `/map`, `/read`, PageUp
   scrolling — with the browser architecture: the server/client split, the API
   contract, where secrets live and why they never reach the browser. Everything
   below the UI layer (state, ops, duration, checks, factions, economy,
   diplomacy, replay) is still accurate; leave it alone.

   Stale documentation of a deleted frontend is worse than none — it is the
   first thing a future agent will read and believe.

5. **Cost note.** Document the actual per-turn cost. A resolution call measured
   ~$0.02; a turn is one resolution per declared action plus one reaction call.

## Acceptance

- Fresh clone → `pnpm install` → `pnpm login` → `pnpm play:web` works on macOS.
- `pnpm test` green.
- `pnpm replay <campaign>` rebuilds a browser-played campaign byte-identically.
- `grep -ri "ink\|braille" src/ CLAUDE.md README.md` returns nothing but
  deliberate historical notes.
- CLAUDE.md accurately describes the system as it now stands.
```

---

## Suggested execution order

```
Prompt 1  ── foundation, must be alone
             │
     ┌───────┴───────┐
     ▼               ▼
Prompt 2         Prompt 4       (server and map renderer are independent)
  server           SVG map
     │               │
     ▼               │
Prompt 3 ────────────┘
  client shell
     │
     ▼
Prompt 5  panels, diplomacy, briefing
     │
     ▼
Prompt 6  parity, packaging, docs
```

Prompts 2 and 4 can run concurrently after 1. Everything else is sequential.

---

## Things a subagent will get wrong without being told

These cost real time in Phase 1. Every one is in the Shared Preamble, but they
are worth repeating to any agent that seems to be flailing:

1. **Auth is not `claude auth login`.** That writes to the macOS keychain, and
   on this machine the write silently does nothing. The working path is
   `claude setup-token`, whose output is stored at `~/.paxgalactica/oauth-token`
   and injected as `CLAUDE_CODE_OAUTH_TOKEN`. `pnpm auth` verifies with a real
   call.
2. **`setup-token` needs a TTY** and prints a token that wraps across two
   terminal lines. Anything parsing it must rejoin the lines.
3. **`maxTurns: 1` breaks every call** under `outputFormat: json_schema`.
4. **pnpm's built-in commands shadow package scripts** — hence `save-token`.
5. **The platform binary resolves from the SDK's location, not the project
   root**, under pnpm's strict node_modules layout.
6. **Model calls take 5–15 seconds.** Any UI that does not account for this
   feels broken even when it is working.
```
