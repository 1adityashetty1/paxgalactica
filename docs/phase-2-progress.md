# Phase 2 Progress

Terminal → browser migration. Prompts live in [phase-2-prompts.md](phase-2-prompts.md).

| # | Prompt | Status |
|---|---|---|
| 1 | Platform-agnostic core + API contract | ✅ **done** |
| 2 | Localhost HTTP server | ✅ **done** |
| 3 | Browser client shell (+ retire the TUI) | ✅ **done** |
| 4 | Browser map renderer (SVG) | ✅ **done** |
| 5 | Panels, diplomacy, turn briefing | ✅ **done** |
| 6 | Parity, packaging, documentation | ✅ **done** |

Prompts 2 and 4 may run concurrently once 1 lands. Everything else is sequential.

---

## Decisions taken

- **Ink TUI is retired**, removed in Prompt 3 (not earlier — nothing playable
  otherwise). It adds no validation value: it cannot run headless, and no test
  touches it.
- **`CampaignStore` is async throughout.** No sync variant, since the only
  caller that needed one is being deleted.
- **Dependencies:** still pending user approval. Recommended is Vite only —
  `node:http` + SSE for the server, React already installed.

---

## Prompt 1 — Platform-agnostic core + API contract

**Status: done.** 178 tests green (was 160). Replay still byte-identical.

- [x] `CampaignStore` + `FileCampaignStore` + `MemoryCampaignStore` — `src/engine/store.ts`
- [x] `Campaign` takes a store; async throughout
- [x] `src/api/contract.ts` — Zod schemas for every client/server message
- [x] `src/ui/briefing.ts` → `src/engine/briefing.ts`, structured not styled
- [x] `src/play.tsx` kept compiling (async load via `useEffect`)
- [x] Tests: `tests/store.test.ts`, `tests/contract.test.ts`
- [x] `pnpm test` green, `pnpm replay` byte-identical

### Files added

| File | Purpose |
|---|---|
| `src/engine/store.ts` | `CampaignStore` interface + file and memory implementations |
| `src/engine/briefing.ts` | `buildBriefing()` returning structured data |
| `src/api/contract.ts` | Zod schemas + `ROUTES` + `ServerEvent` union |
| `tests/store.test.ts` | Store round-trip, isolation, path traversal, staged-never-persisted |
| `tests/contract.test.ts` | Contract validated against **live engine output**, not fixtures |

### Decisions and things worth knowing

- **`Campaign.load()` returns `null`** for a missing campaign instead of
  throwing. A server route asking "does this exist" should not need a
  try/catch.
- **`Campaign.save()` returns the campaign name, not a path.** A store may have
  no filesystem, so a path is not a meaningful return value any more.
- **`FileCampaignStore` validates the campaign name** against `/^[\w.-]+$/`.
  Nothing untrusted reaches it today, but an HTTP route is one step away, and
  `../../etc/passwd` should never be a save name. Tested.
- **`MemoryCampaignStore` deep-copies on read and write**, so a test cannot
  mutate stored state by holding the object it saved — a real file cannot be
  abused that way and the fake should not differ.
- **`SAVE_DIR`, `SaveFileSchema` are re-exported from `campaign.ts`** so
  `src/replay.ts` and existing importers did not need touching.
- **Contract tests validate against real engine output.** A hand-written
  fixture would agree with the schema by construction and prove nothing.
- **Two live bugs fixed in the TUI** while making it compile: `:save` printed
  `[object Promise]`, and `:quit` could exit before the write flushed. Both now
  await.

### Carried into Prompt 2

- `ApiErrorSchema` defines the error codes; the server should use only those.
- `ServerEventSchema` has a `hello` variant — send it on SSE connect so the
  client can confirm the stream is live rather than guessing.
- `CampaignViewSchema` is the single payload shape for "draw everything".
  Prefer pushing a whole view over patching fields.
- `DEFAULT_PORT` is 4173, overridable via `PAXGALACTICA_PORT`.

---

## Prompt 2 — Localhost HTTP server

**Status: done.** 204 tests green (was 178). `pnpm serve` runs it.

- [x] `node:http` server on **127.0.0.1** only, port 4173 / `PAXGALACTICA_PORT`
- [x] Server preflight (auth checked at startup, TTY check dropped)
- [x] One campaign per process, in module state, commented as such
- [x] Every route validates its body; structured errors with codes
- [x] SSE at `/api/events` — `hello`, `progress`, `state`, `error`
- [x] Static serving of `dist/web` when present, with SPA fallback
- [x] Busy guard: 409 on a second model call while one is in flight
- [x] Graceful shutdown saves and warns about lost staged actions

### Files added

| File | Purpose |
|---|---|
| `src/server/session.ts` | `GameSession` — the whole API as plain async methods, no HTTP |
| `src/server/router.ts` | `dispatch(session, method, path, body)` → `{status, body}` |
| `src/server/errors.ts` | `ApiFailure` with codes → HTTP status, `parseBody`, `toApiFailure` |
| `src/server/events.ts` | `EventHub` for SSE, with keep-alive |
| `src/server/static.ts` | Static files with a containment check |
| `src/server/index.ts` | node:http glue, preflight, shutdown |
| `tests/server.test.ts` | 26 tests through `dispatch`, no port bound |

### Verified live

```
lsof -nP -iTCP:4173 -sTCP:LISTEN
  node ... TCP 127.0.0.1:4173 (LISTEN)      ← loopback, not *

GET  /api/factions            200  5 factions, 0 saves
GET  /api/campaign            409  {"code":"no_campaign"}
POST /api/campaign/new        200  full CampaignView
POST /api/campaign/new  bad   400  "factionId: expected string, received number"
GET  /api/nope                404  {"code":"not_found"}
POST /api/events              405  "GET only."
SSE  /api/events                   hello + state pushed on campaign creation
SIGTERM                            "Campaign saved."
```

### Decisions and things worth knowing

- **`dispatch()` is the testable seam.** Routing is `(method, path, body) →
  {status, body}` with no `req`/`res`, so all 26 server tests run without
  binding a port or mocking node:http.
- **No CORS headers, deliberately.** Same-origin only. A permissive policy would
  let any page in the browser drive a game that spends money.
- **The busy guard refuses rather than queues.** Staging assumes ordered
  declarations; two resolutions racing would interleave ops unpredictably. A
  test holds the guard open and asserts the second request gets a 409, and
  another asserts a *throwing* call still clears it.
- **The diplomacy boundary is enforced server-side now**, not just in the UI:
  actions and end-of-turn are refused while a channel is open, and you cannot
  open a second channel or talk to yourself. The browser cannot bypass it.
- **`endTalk` closes the channel before extraction runs**, so a failed
  extraction cannot strand the UI with a channel it can never close.
- **Auth errors map to 401, not 500.** `toApiFailure` recognises both "not
  signed in" and a rejected token, so the client can tell the user to run
  `pnpm login` instead of showing a generic failure.
- **Path traversal is blocked in three places** — campaign names, faction ids in
  URLs, and static file paths. All three are tested.
- **SSE over WebSocket** because traffic is one-way, it reconnects on its own,
  and it needs no dependency.

### Carried into Prompt 3

- Consume `/api/events` for progress; the label is human-readable and meant to
  be shown verbatim ("Resolving", "Ojjul Hutt Combine considers").
- `state` events carry a whole `CampaignView` — replace, do not patch.
- Handle **409 `conflict`** as an expected outcome, not an error: it means a
  call is already running. Disable the input rather than showing a red banner.
- The client build must land in `dist/web` for the server to serve it.
- `GET /api/campaign` returns 409 `no_campaign` on a cold start — that is the
  signal to show the faction picker.

---

## Prompt 3 — Browser client shell (+ TUI retired)

**Status: done.** 196 tests green. `pnpm play:web` runs the game in a browser.

- [x] Vite + React + TS in `web/`, building to `dist/web`
- [x] Client imports `src/api/contract.ts` directly — one contract definition
- [x] `pnpm dev:web` (Vite, proxying /api), `pnpm play:web` (build + serve + open)
- [x] Layout: map, side panel, briefing, message feed, command line
- [x] SSE-driven busy state with the server's own label
- [x] Faction picker + resume list
- [x] `:`/`/` commands, free text as the default action
- [x] **Ink TUI removed**, `ink` dependency dropped

### Verified in a real browser

Faction picker → started Arkanis Free Worlds → declared *"Fortify the orbital
approaches of Dolomar"* → check rendered `industry · d20 13+0 = 13 vs DC 13 →
success` → narrative → staged panel → **end turn** → four in-voice reactions →
briefing with in-progress work and observed enemy projects → saved → resumed
after a server restart with dispositions intact (Vigil −63, Meridian +13).

A full turn costs **~$0.12** and takes **~42s** (one resolution + one reaction
call). The progress label is doing real work at that duration.

### Files added

`web/index.html`, `web/tsconfig.json`, `vite.config.ts`, `scripts/play-web.mjs`,
and under `web/src/`: `main.tsx`, `App.tsx`, `api.ts`, `useGame.ts`, `color.ts`,
`styles.css`, `components/{GalaxyMap,SidePanel,BriefingPanel,FactionPicker,types}`.

### Removed

`src/play.tsx`, `src/ui/{App,MapPane,SidePanel,FactionPicker,useTerminalSize,
briefing,wrap}`, `tests/wrap.test.ts`, the `ink` dependency, the `play` script,
and `assertInteractiveTerminal` + `runPreflight` (no caller needs a TTY now).

**Test count fell 204 → 196**: 6 from `wrap.test.ts` and 2 TTY tests. Both cover
terminal-only behaviour with no browser analogue — the sanctioned exception to
"never delete a test".

**Kept, contrary to the original plan:** `src/ui/braille.ts` and its 12 tests.
`map.ts` still imports it, and Prompt 4 is what restructures `map.ts`. Deleting
it now would have broken a module that prompt is about to rewrite.

### Bugs found and fixed

- **`post()` had a vestigial `path` parameter**, so every request body was
  landing in the wrong argument slot. Vite does not typecheck, so this only
  surfaced via `pnpm typecheck:web` — that script exists for exactly this.
- **Staged count was inflated.** `submitAction` staged the check-record
  `log_narrative` as its own batch, so one declared action showed as "2
  declared" with a meaningless `check record` entry. The check op now rides
  along with the action's own ops.

### Notes for Prompt 4 / 5

- `GalaxyMap.tsx` is **deliberately minimal** — fixed viewBox, no zoom/pan, no
  label collision. Prompt 4 replaces it using layout maths extracted from
  `src/ui/map.ts`.
- The briefing panel shows "End a turn to see the situation report" after a
  resume, because `lastBriefing` is derived from a tick and not persisted.
  Prompt 5 may want to reconstruct it from state on load.
- Diplomacy is functional but plain: `/talk <faction>` prefills `@id ` and the
  reply lands in the feed. Prompt 5 gives it a real chat view.
- Automated browser clicks did not reliably reach React's synthetic events;
  `form.requestSubmit()` did. That is a harness quirk, not an app bug, but
  worth knowing if a future agent tries to drive the UI.

---

## Prompt 4 — SVG map renderer

**Status: done.** 196 tests green.

- [x] Layout maths extracted to `src/ui/layout.ts` — normalised coords, no DOM
- [x] SVG renderer with zoom, pan, click-to-select, hover tooltip
- [x] Faction-coloured internal lane networks; grey border lanes
- [x] Fleets in transit positioned along their path, with ETA
- [x] Sector zoom via a dropdown
- [x] `tests/layout.test.ts` — 20 tests

### The layout contract

`layoutGalaxy()` returns a **unit-width space**: `x` spans 0–1, `y` spans
0–`aspect`. A consumer sets `viewBox="0 0 1 aspect"` and gets undistorted
geometry at any size. That is what makes the geometry testable without a DOM.

`MIN_ASPECT` (0.22) and `MAX_ASPECT` (0.85) replace the terminal's
`MAX_STRETCH`. The Kessel Fringe spans x 13–87 but y only 26–32 — an unclamped
aspect of ~0.08, a hairline. The floor keeps it readable; the ceiling stops a
tall sector becoming a column. Verified in the browser.

### Removed

`src/ui/map.ts` (451 lines), `src/ui/braille.ts` (112), `tests/map.test.ts`,
`tests/braille.test.ts`. Braille has no browser analogue; SVG does real text
layout, so the label-collision machinery went with it. `src/ui/` is now just
`ansi256.ts` and `layout.ts`.

### Bug found

Labels sit to the **right** of their glyph, but padding was symmetric — so
Sarsuma, the easternmost system, had its name clipped. Padding is now
asymmetric (30 left, 190 right).

---

## Prompt 5 — Panels, diplomacy, turn briefing

**Status: done.** 202 tests green (was 196).

- [x] Dedicated diplomacy chat panel, per faction, in that faction's colour
- [x] `talk` buttons on every faction; `/talk <name>` still works
- [x] Per-item staged discard, not just "discard all"
- [x] Briefing reconstructed on resume instead of an empty report
- [x] Help command explains the five stats and how checks resolve
- [x] Log filters by kind (`rejection` / `clamp` stay visible, not hidden)
- [x] Stat bars, ethics chips, progress bars with ETA

### Verified live in the browser

Clicked `talk` on Iron Vigil → channel opened in Vigil red with the boundary
banner → sent *"We propose a truce along the Drift border"* → Vigil replied in
character: **"You hold no commission, no seal, no legitimacy — you are a
rebellion that has not yet been pacified."** It refused to recognise a rebel
government (its declared red line) and used no contractions, unprompted.

While the channel is open the command line reads "Close the channel to declare
actions" and **End turn** is disabled — the boundary is visible in the UI, not
just enforced server-side.

### Design notes

- **The channel is its own surface**, not a mode of the command line. In the
  terminal, dialogue and narration shared one scrolling feed, which made
  negotiations hard to follow and the boundary invisible.
- **A channel can be *intended* before it exists.** Clicking `talk` sets a local
  `draftChannel`; the server opens the real channel on the first message. The
  panel renders from either, so there is no empty round trip just to open.
- **Per-item discard replays rather than undoes.** Removing declaration #1 has
  to re-run #2 against committed state, because #2 may have been resolved
  against #1. A test pins this: 1100 − 100 − 200 = 800, and dropping the first
  yields **900**, not 1000.
- **`briefingFromState()`** derives a briefing with no turn behind it, for
  resumes. Completions are necessarily empty; in-progress work is not.

### New tests

`tests/diplomacy.test.ts` (18) pins the boundary at every layer: the chat schema
has only `reply` and *strips* an injected `ops` field, its generated JSON schema
contains no `ops` at all, transcripts stay out of the journal, each faction's
memory is separate, and the extraction prompt still refuses rejected,
unanswered and conditional offers while treating deception as binding.

`tests/server.test.ts` gained 6: per-item discard, index renumbering, preview
rebuild, out-of-range rejection, and the resume briefing.

---

## Prompt 6 — Parity, packaging, documentation

**Status: done. Phase 2 complete.** 238 tests green.

- [x] `tests/parity.test.ts` — campaigns driven through the server's own
      handlers, then rebuilt from the journal byte-identically
- [x] `pnpm play:web` verified from a clean `dist/web`
- [x] Graceful shutdown saves; staged actions warned about
- [x] CLAUDE.md rewritten: TUI section replaced with server/browser architecture
- [x] Cost documented from measurement

### Acceptance, verified

```
pnpm test                     238 passed
pnpm typecheck                clean
pnpm typecheck:web            clean          ← Vite does not typecheck; this does
pnpm play:web (clean build)   compiles, builds, serves, opens
  GET /                       200
  GET /api/factions           200
SIGINT                        "Campaign saved."
pnpm replay acceptance        rebuilt turn 2, no model calls
grep -ri "ink|braille"        4 hits, all deliberate historical notes
```

### The parity test is the real deliverable

Four tests drive `dispatch()` through multi-turn campaigns — a shipyard, a
fleet movement, a treaty, an agent, ships moved into a rival's system, a
mid-turn discard, and a quiet turn — then assert `verifyReplay()` and a cold
rebuild from the store both match byte-for-byte. One covers a campaign resumed
in a second `GameSession` and played on, which is the case most likely to drift.

Model-backed routes cannot run under `PAXGALACTICA_NO_NETWORK=1`, so
declarations are staged directly — the same path `submitAction` uses once
resolution returns. What is under test is the commit/tick/journal pipeline the
HTTP layer drives, not the model.

### Documentation

The TUI section (Ink, Braille, `/zoom`, `/read`, PageUp) described a frontend
deleted in Prompt 3. Replaced with: the server/browser split and why it falls
where it does, the Zod-first contract and route table, server rules (loopback
only, no CORS, one campaign per process, busy guard), the browser client, and a
measured cost section.

Everything below the UI layer was left alone — it was still accurate.

### Known gaps

- **Model-facing prompts remain the least-tested surface.** They are exercised
  by hand, not by the suite, because the suite has no network by design.
- **`dissent` is tracked but inert.** It rises on a doctrine refusal and
  displays; nothing reads it yet.
- **No test drives the browser itself.** Verification was manual via the
  browser tools. A Playwright pass would close that, at the cost of a
  dependency.
