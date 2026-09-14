# Architecture — open questions about the shape of the program

`docs/todo.md` is about the **game**: mechanics that are inert, rulings that
wobble, things a playtest found. This file is about the **program**: how it is
built, what it depends on, how it is delivered and who pays for the model calls
it makes. Nothing here makes the game better to play. It is here because those
questions kept being answered inside game items, where they did not belong and
could not be ranked against each other.

Items are `A.N`, and unlike `todo.md` they are **not ranked** — this is a
brainstorm, and most of it is undecided on purpose. Where something has been
measured rather than assumed, the measurement is given, because the whole reason
this document exists is that the earlier version of A.1 carried three claims
that turned out to be guesses.

**The question this document is actually trying to answer:**

> Can Pax Galactica be one thing a person downloads, opens, pastes a key into,
> and plays — with no clone, no pnpm, no Node, no `claude setup-token`, and no
> Claude subscription?

The short answer, ahead of the working: **yes, and the packaging is the easy
half.** The hard halves are the credential (A.5, A.6) and the fact that the
thing being packaged is a *local web server that spends the user's money*
(A.8, A.9).

---

## A.1. The provider seam — playtests are billed to the subscription, with no way to pay otherwise

> Moved here from `docs/todo.md` item 95, which is now a pointer. It was ranked
> against game mechanics for its whole life and always came last, because
> nothing in the game gets better for building it. It is the **first**
> architecture item, since everything else in this document depends on it.

**This is a usage item, not a performance one.** It was filed as both and the
performance half has since been measured away — see "what the raw-JSON result
did to this" below. What remains is the thing it was actually filed for: every
model call in the game reaches Anthropic through `rawCall` in
`src/model/client.ts`, which spawns the bundled Claude Code binary under
subscription auth, and there is no way to point it anywhere else. So the cost of
playing is denominated in Claude usage and in nothing else — fine while the game
is being *played*, wrong while it is being *tested*, which is most of what
happens to it.

### The scope that serves that

`rawCall` is the only function in the codebase that touches the Agent SDK, about
seventy lines, with **one call site** (`client.ts:189`). Everything above it is
already provider-agnostic: the retry budget, the Zod re-validation, the
correction prompt, `stats`, the per-message deadline. So this is an extraction,
not a rewrite.

- **`src/model/provider.ts`** — `interface Provider { call(tier, system, user,
  jsonSchema) }` with today's `rawCall` body as one implementation and an HTTP
  client as the other. Chosen by env, defaulting to today's path.
- **`router.ts`** — `TierConfig` mixes shared config (`model`) with SDK-only
  fields (`maxTurns`, `effort`, `thinking`). Split it, and put the alternate
  tier table beside `TIERS` so the file's own promise — *tiering is a one-line
  edit* — holds for both.
- **`costUsd`** from the response's token usage against a price table. `stats`
  and `timingReport` are unchanged.
- **`preflight.ts`** calls `assertLoggedIn` unconditionally. Gate it on the
  provider and substitute a reachability probe whose failure message has the
  same shape as the auth one.
- **`PAXGALACTICA_NO_NETWORK=1` still throws**, localhost included. That guard
  is about the suite being pure, not about the wire.

Replay is untouched: the journal records ops, not reasoning, so a campaign
played against any provider replays byte-identically under `pnpm replay`.

### It needs a credential, and the local escape hatch does not survive contact

"OpenAI-compatible" is a wire format rather than a vendor — Ollama, LM Studio
and `llama-server` all speak `POST /v1/chat/completions`, and a local server
needs no key. That was the original hope, and it does not work here for two
reasons, both checked rather than assumed:

- **Nothing local is installed** on the machine this is developed on, and no
  listener answers on :11434 or :1234.
- **16GB of unified memory caps the model** at roughly `gpt-oss-20b` at MXFP4.
  That is enough for `appraisal`, `breach_relevance` and `flavor`, which are
  bounded classifications against a rubric. It is not enough for `extraction`,
  which must emit real faction, system and treaty ids read out of a transcript
  — and a playtest in which every accord produces nothing is not a playtest.

So covering the whole call set means a hosted endpoint and a key: OpenRouter, a
direct provider, or Anthropic. A **split** is the configuration worth having and
`ROUTES` already expresses it — a cheap model for the three bounded kinds beside
a strong one for `resolution` and `extraction`.

### What the raw-JSON result did to this

The argument for this item used to be ~7-8s of transport on every call, roughly
50s a turn. Most of that was the SDK's end-turn carrier: under `outputFormat:
json_schema` the result comes back through a `tool_use`/`tool_result` pair,
which is a second agentic round trip that re-sends the whole context.

`PAXGALACTICA_RAW_JSON=1` removes that carrier **without leaving the
subscription**, and measured a turn from ~98s to ~37s. What is left of the
transport floor is the process spawn — appraisal runs 4.5s for ~7.6k in and
~200 Haiku tokens out, of which generation is maybe 2s — so about 2.5s a call,
15-18s a turn rather than 50s.

That reshapes what this is worth:

| | still worth it |
|---|---|
| **usage** — playtests stop billing the subscription | yes, and it is the reason this exists |
| **caching** — identical prefixes per call kind, `resolution.md` alone is ~8.5k tokens | yes, now the main cost lever |
| **latency** — spawn removal | ~15-18s a turn, down from ~50s |
| **size** — the SDK's platform binary is 267MB | **new**, and it is what makes A.4 tractable |

**Caching is the lever, so resolve it before choosing a vendor.** Sources
conflict on whether OpenRouter passes a provider's cached-input tier through;
verify against the live model page rather than trusting this note.

### Two things to get right that a naive port would not

Checked against the current API rather than recalled:

- **`output_config.format`** is the parameter, not the deprecated
  `output_format`. Do **not** set `strict: true`: it requires every property in
  `required` and `additionalProperties: false`, which contradicts
  `z.toJSONSchema(..., { io: 'input' })` advertising defaulted fields as
  optional.
- **The tier config does not port as-is.** `output_config.effort` errors on
  Haiku 4.5, and the flavour tier sets `effort: 'low'` today. `thinking:
  {type:'disabled'}` is not the Haiku form — omit `thinking` there. On Sonnet 5
  `budget_tokens` is removed and returns a 400. And the model id has drifted:
  the router says `claude-haiku-4-5-20251001` where the current id is
  `claude-haiku-4-5`, no date suffix.

### What this does not solve

**The driver.** The Agent tool takes `sonnet`/`opus`/`haiku`/`fable` and has no
hook for an external provider, so a seam in `src/model/` cannot re-point the
playtest agent. Driving todo 92 with a third-party model means writing the
harness: `dispatch(method, path, body)` is already the seam, and the loop is
`GET /api/campaign` → build a prompt → `POST /api/action` or `/api/talk/:id` →
`POST /api/endturn`. Call it 150 lines.

That harness earns its keep on a second axis, which is the better argument for
it: **it is repeatable.** A scripted playtest can be re-run against the same
seed after a prompt edit, which is what prompt versioning exists to enable and
what an interactive agent session cannot do.

**The cheap version is one line:** `model: sonnet` in the agent's frontmatter,
or passed at spawn. Do that first.

### On Kimi K3 specifically, since it prompted this

Recorded so the question need not be re-researched. Figures are from secondary
aggregators, September 2026, and are directionally reliable at best.

- 2.8T parameters, 104B active (16 of 896 routed experts), MXFP4, 1M context.
  **Active parameters set compute; total parameters set memory** — it generates
  about as fast as a 104B dense model and needs every expert resident.
- Near-frontier: ~60 on the Artificial Analysis index against Opus 5's 63, and
  93.4% SWE-bench Verified against 95-96% for the closed leaders. It *leads*
  SWE Marathon, the long-session benchmark — the one that resembles a playtest.
- **$3 / $15 per M, $0.30 cached** — essentially Sonnet's list price. Hosted K3
  is not a cost reduction; it is a conversion of subscription usage into
  dollars.
- **No free API tier.** Adagio is the consumer chat plan, not an API plan, and
  there is no `:free` variant on OpenRouter.
- **Self-hosting is out.** ~594 GB of weights, so eight H100s merely to load
  them and ~1,680 GB by vLLM's own estimate to serve them; Moonshot suggests
  ≥64 accelerators. Renting that for an hour costs more than many campaigns of
  API.

---

## A.2. What actually has to be in the box

Before choosing a packaging tool, the inventory — measured on this checkout, not
estimated:

| what | size | how it is reached today |
|---|---|---|
| the server + domain code | ~1.2MB of `dist` | `node dist/server/index.js` |
| `zod` | ~2.5MB installed | the **only** non-SDK runtime dependency of `src/` |
| `prompts/*.md` | 10 files, ~2,300 lines | `readFileSync` at a path relative to the module |
| `dist/web` | 370KB JS + 19KB CSS | served by `serveStatic` from `dist/web` |
| portraits | 844KB | `web/public/portraits/<factionId>.jpeg` |
| outcome art | 336KB | `web/public/events/` |
| `saves/` | grows | `join(HERE, '..', '..', 'saves')` — **inside the install** |
| the Agent SDK's JS | 3.9MB | `import { query } from '@anthropic-ai/claude-agent-sdk'` |
| **the Claude Code binary** | **267MB** | `@anthropic-ai/claude-agent-sdk-darwin-arm64`, spawned per call |
| Node itself | 50-110MB | assumed present; `./start` checks the version |

**The load-bearing measurement is the first column's spread.** Everything the
game *is* — engine, reducer, prompts, art, client — is about **2.8MB**. The
dependency graph of `src/` is exactly two packages:

```
@anthropic-ai/claude-agent-sdk
zod
```

React is a build-time dependency of `web/` and is already inside the 370KB
bundle. There is no native addon anywhere, no `node-gyp`, no platform build
step. So once A.1 removes the SDK import, **the entire server is a pure-JS
single-file bundle** and every packaging option in A.4 becomes available at
once. That is the real reason A.1 comes first.

---

## A.3. The 267MB question

The Claude Code binary is 99% of what a packaged app would weigh and 0% of what
it would do that an HTTP call could not. Shipping it is also the one thing in
this document that is arguably not ours to ship — it is a vendor binary
delivered as an npm optional dependency for a *developer's* machine, and
redistributing it inside a game executable is a licensing question rather than a
technical one, which is a reason to avoid needing the answer.

There is a second, subtler cost: **it makes the subscription path
undistributable even if the licensing were fine.** A packaged app that spawns
`claude` requires the player to have a Pro/Max subscription *and* to have run
`claude setup-token` in a terminal — which is the entire setup burden the
packaging exercise exists to remove. The subscription path is a *developer*
path. It should stay, it should stay the default in a clone, and it should not
be what a downloaded build uses.

So the split this document proposes is:

| build | provider | credential | who it is for |
|---|---|---|---|
| **clone** (`./start`) | Agent SDK, spawned binary | `~/.paxgalactica/oauth-token` | whoever is working on the game |
| **packaged** | HTTP, `provider.ts` | a key the player pastes in | whoever wants to play it |

Both come out of the same source tree and the same `Provider` interface. The
packaged build simply never imports the SDK — which, with a bundler, means the
267MB is not merely unused but **absent**, since nothing reaches it.

---

## A.4. Four ways to make it one file, and what each costs

All four assume A.1 has landed and the SDK is out of the packaged path.

### 1. Node SEA (`node --experimental-sea-config`)

Bundle to one `.js` with esbuild, then inject it into a copy of the `node`
binary. **~60-110MB**, one file, no runtime installed.

- Assets are the friction: SEA embeds a blob you read with
  `sea.getAsset()`, so `prompts/` and `dist/web` want embedding rather than
  `readFileSync` (see A.7). That is a loader change, not a content change.
- Still marked experimental, and on macOS the result must be re-signed after
  injection or it will not launch at all.

### 2. `bun build --compile`

The same idea with the sharp edges already filed down: one command, embedded
assets via `Bun.file` imports, cross-compilation targets, ~60MB output.

- The cost is a second runtime to reason about. The suite is vitest on Node,
  `./start` checks Node, and the engines field pins Node. Building the shipped
  artefact on a runtime the tests never exercise means the thing tested and the
  thing shipped are not the same program.
- Mitigated but not removed by the fact that everything below `src/server/` is
  pure and runtime-agnostic — the exposure is `node:http`, `node:fs` and
  `spawnSync`, all of which Bun implements.

### 3. Electron or Tauri

Ship the browser too, so the app is a window rather than a tab.

- **Electron** is +150MB of Chromium for a UI that already runs in the
  player's browser. It buys a real app window, a dock icon, and no "open
  127.0.0.1:4173 yourself" step.
- **Tauri** uses the OS webview, so ~10MB plus the server — but adds Rust to a
  project whose whole bootstrap story is *one toolchain, and `./start` exists
  only because the Node check cannot be written in Node*. That is a large
  contradiction to take on for a window frame.

### 4. Not a binary at all

`npx paxgalactica`, or a tarball plus `./start`. Zero packaging work, ~3MB, and
it keeps the current bootstrap exactly as it is.

- The cost is that the player must have Node. That is the *entire* thing being
  removed, so this is the fallback rather than the answer — but it is worth
  keeping because it is nearly free and it is a strictly better version of
  today's "clone the repo" instruction.

**The recommendation, if one is wanted now:** do **4** immediately (it is
almost no work and it is what a second person could use this week), and treat
**1** as the target once A.1 and A.7 are done. Revisit **3** only if the "open a
URL" step turns out to be what actually loses people, which is a question about
players rather than about code.

---

## A.5. Where the credential lives, and the inversion nobody will expect

Today the credential story is written entirely around the subscription, and two
pieces of it **invert** in a packaged API build:

**`buildAuthEnv` deletes `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN`.** That
is correct today and precisely wrong in API mode, where a key is the point. The
stripping is a property of the *subscription provider* — it exists so a key
exported from a shell profile cannot shadow the subscription or bill an API
account by accident — so it must move into that provider's implementation
rather than being deleted or generalised.

**`preflight.assertLoggedIn` aborts the server** when the binary does not report
subscription auth. In a packaged build there is no binary, so the whole probe is
inapplicable; what replaces it is *"is there a key, and does the endpoint answer
it"*, which has the same job and a completely different failure message.

Beyond that, the shape of it:

- **Entered in the app, not in a terminal.** `pnpm login` is a developer
  affordance. A packaged build needs a first-run screen: the app starts with no
  campaign (`GET /api/campaign` already returns **409 `no_campaign`** on a cold
  start, so there is a state to hang this on), the player pastes a key, it is
  `POST`ed to a local route and stored.
- **Stored where the OS puts config, not where the app is installed.** Today:
  `~/.paxgalactica/oauth-token`, mode 0600, deliberately outside the repo so it
  cannot be committed. That location is already right and should simply gain
  siblings — one file per provider, or one small JSON.
- **It never reaches the browser.** The rule `src/model/` already lives by. The
  key is POSTed *in*, and is never returned by any route, never embedded in
  client JS, never served as a file. A settings screen shows `sk-…4f2a`, not the
  key.
- **`looksLikeOAuthToken` is subscription-shaped** (`/^sk-ant-oat[\w-]{10,}$/`).
  API and OpenRouter keys have their own prefixes, and the validator's real job
  is catching a truncated paste, so it becomes a per-provider pattern rather
  than one regex.

### The thing that is genuinely new: the app now spends the player's money

Under a subscription, an overspend is an inconvenience. Under a pasted API key
it is a bill, and a turn costs about **$0.29** at today's tiers. A downloaded
executable that can bill a stranger's card needs to say so before it does it:

- **A running total on screen.** `stats.costUsd` and `timingReport()` already
  exist and already split by call kind; nothing new has to be measured, only
  shown.
- **A cap the player sets, enforced in `callStructured`.** The one place every
  call passes through, which is the same argument that makes tiering and retry
  policy single-sited.
- **The estimate stated up front**, on the same screen as the key: a campaign of
  30 turns is roughly $9 at Sonnet rates, less on a split routing.

None of that is packaging work, and all of it becomes mandatory the moment the
thing is handed to someone else.

---

## A.6. Three ways a player can pay, and what each actually requires

| | what the player provides | what it costs them | what breaks |
|---|---|---|---|
| **subscription** (today) | a Pro/Max plan, plus `claude setup-token` in a terminal | usage against their plan | needs the 267MB binary; not distributable (A.3) |
| **Anthropic API key** | `sk-ant-…` from console.anthropic.com | ~$0.29/turn, billed | nothing — same models, same prompts, same tiers |
| **OpenRouter key** | `sk-or-…` | model-dependent; a cheap tier for the bounded calls | prompt caching is uncertain (A.1); model ids change shape |

**A packaged build should accept at least two**, and the reason is not
generosity. Anthropic-direct is the configuration this game's prompts, schemas
and tier table were actually developed and measured against, so it is the one
where a bug is a bug rather than a model difference. OpenRouter is the one that
makes the game playable by someone who will not open a second billing account —
and it is also the hedge, since it is the only option that lets a player route
`resolution` and `extraction` to whatever is best this month without a code
change.

The `ROUTES` table is already the right shape for this: it maps eight call kinds
onto three tiers, so *"cheap model for `appraisal`, `breach_relevance`,
`flavor`, `advisor`; strong model for `resolution`, `extraction`, `epilogue`"*
is a data change, not an architecture one. What a packaged build adds is that
the table becomes **configuration** rather than source — which is a real
decision to make, because today the file's own comment promises that tiering is
a one-line edit in TypeScript, and a player with a settings screen cannot edit
TypeScript.

---

## A.7. Paths that are wrong the moment the app is read-only

Three filesystem assumptions hold in a clone and fail in an installed
application. All three are one-line facts today, which is the good news.

| what | today | why it breaks |
|---|---|---|
| `PROMPT_DIR` | `join(HERE, '..', '..', 'prompts')` | there is no `prompts/` beside a single-file binary |
| `SAVE_DIR` | `join(HERE, '..', '..', 'saves')` | an app bundle is read-only, and on macOS it may be quarantined |
| `WEB_ROOT` | `join(HERE, '..', 'web')` | same as prompts |

**Prompts should be embedded at build time, and the project's own rule survives
that.** CLAUDE.md's requirement is that prompts are *versioned `.md` files,
never inline strings*, and the reason given is that a prompt change must show up
as a reviewable diff and be replayable against a recorded campaign. Embedding at
**build** time keeps every word of that: the `.md` files remain the source of
truth and the thing git diffs; only `loadPrompt` changes, from `readFileSync` to
a generated module or a SEA asset. Inlining the *text into source* is what the
rule forbids, and this is not that.

**Saves must move to a user data directory** — `~/Library/Application
Support/PaxGalactica/saves` or `~/.paxgalactica/saves`. That is a genuine
behaviour change and wants care, because `pnpm resume <file>` installs an
archive into `SAVE_DIR` and the CLI and the app would then disagree about where
campaigns live. The archive format is already the answer to moving a campaign
between machines; it should also be the answer to moving one between the clone
and the packaged build, rather than the two sharing a directory by luck.

---

## A.8. What stops being true when the binary goes away

Not a list of work so much as a list of **claims in the codebase and in
CLAUDE.md that are currently stated unconditionally** and become
provider-conditional. Each is a place where a packaged build would otherwise
produce a confidently wrong error message:

- `resolveClaudeBinary()` returning `null` currently means *"the install is
  broken"*. In API mode it means nothing at all.
- `NotLoggedInError`'s message tells the player to run `pnpm login` and
  `pnpm auth` — instructions that name a package manager the packaged build
  does not have.
- `pnpm doctor` checks runtime, deps, binary, auth and port. Three of those five
  are about the SDK path.
- `./start` and `scripts/play-web.mjs` are the bootstrap for a clone and have
  no role in a packaged build, which has to open its own browser (`open`,
  `xdg-open`, `start`) or tell the player the URL.
- The CLAUDE.md **Authentication** section is written as though subscription
  auth is the only kind. It would need a sibling section rather than an edit,
  since both remain true for their respective builds.

---

## A.9. The things that are not code

These are the ones that sink a packaging effort late, so they are written down
early:

- **macOS Gatekeeper.** An unsigned, un-notarized binary downloaded from the
  internet does not run — it is quarantined, and the error the player sees says
  the file is damaged. Signing needs a paid Developer ID; notarization needs an
  upload to Apple on every build. This is the single largest non-code cost of
  option 1 or 2 in A.4, and it does not apply to option 4 at all.
- **Windows.** SmartScreen has the same shape of problem with a different
  remedy, and `scripts/play-web.mjs` only knows how to open a browser on
  darwin. Nothing in `src/` is macOS-specific, so this is surface work — but it
  is unexercised surface.
- **A localhost server with no authentication** is a deliberate and well-argued
  design in a clone, where the player started the process themselves. Handing
  that binary to other people does not change the security argument (127.0.0.1
  only, no CORS, one campaign per process) but it does change who is
  responsible for it, and it makes *port already in use* a real first-run
  failure rather than a developer annoyance.
- **Updates.** A clone is updated with `git pull`. A downloaded binary is not
  updated at all unless something updates it, and a save written by one version
  must still replay under the next — which the journal already guarantees
  (`JOURNAL_VERSION` is at 2 and both versions load), but which becomes a
  promise to strangers rather than to oneself.

---

## A.10. A staged plan, where each stage is worth having on its own

The point of the staging is that nothing here is a prerequisite for a thing
nobody wants — each step is independently useful, and the sequence stops being
worth continuing at any point without stranding work.

1. **A.1, the provider seam.** Useful immediately and for its own reasons:
   playtests stop billing the subscription. Nothing below is possible without
   it, and it is the only step that is pure refactoring.
2. **The key, entered in the app** (A.5) — first-run screen, per-provider
   storage, running cost total, spend cap. This is what makes step 1 usable by
   anyone who is not editing env vars.
3. **Embed prompts and web assets; move saves to a user directory** (A.7).
   Also makes `node dist/server/index.js` runnable from anywhere, which is
   mildly useful on its own.
4. **`npx paxgalactica` / tarball** (A.4 option 4). At this point the game is
   installable by a second person in one command, and everything after this is
   about removing the Node prerequisite.
5. **SEA build + signing** (A.4 option 1, A.9). The actual "downloadable
   executable", and the first step whose cost is mostly not code.

---

## Open questions

Things this document deliberately does not decide:

- **OpenRouter or direct?** Turns on prompt caching, which is unverified and is
  now the main cost lever (A.1). Verify before choosing, not after.
- **Does `ROUTES` become configuration?** A settings screen implies yes; the
  router's own comment implies no. Both cannot be true in the same build.
- **Is `PAXGALACTICA_RAW_JSON=1` the default?** It is the difference between
  ~98s and ~37s a turn and it trades away layer 1 of the two-layer defence. A
  ten-turn campaign decides it (see `todo.md`, above the ranked table), and a
  packaged build wants that settled — a stranger's first turn should not be 98
  seconds of nothing.
- **Does the packaged build ship the subscription path at all?** A.3 argues no.
  The counter-argument is that a Max subscriber pays nothing marginal and would
  rather use it, which is a real player and not a hypothetical one.
