# Running on Cloud Run: a stateless server

An investigation, not a decision. Measured on `main` at 2cd472c with
`scripts/stateless-probe.mjs` (no model calls).

## What is server-side state today

Everything lives on one `GameSession` singleton (`src/server/session.ts`):

| state | where | survives a restart today |
|---|---|---|
| journal, transcripts, epilogue | `Campaign` → `saves/<name>.json` | yes |
| committed world + preview world | `Campaign.committed` / `.state` | rebuilt by replay |
| staged batches, actions declared | `Campaign.stagedBatches`, `actionsDeclared` | **no** |
| open channel: history, concessions, budget, blockers | `GameSession` fields | **no** |
| last briefing (incl. async event flavour) | `GameSession.lastBriefing` | derived on resume |
| busy guard | `GameSession.busyLabel` | n/a |
| SSE subscribers | `EventHub` | n/a |
| telemetry sink, in-flight counter | module globals in `model/telemetry.ts` | n/a |
| saved-campaign list | `FileCampaignStore` (`saves/`) | yes |

Cloud Run gives none of that a home: instances are disposable, a request may
land on any instance, and a separate SSE connection is very unlikely to land on
the instance serving the POST.

## The measurement that makes it cheap

100 turns of bot play, Meridian as player:

| turn | save (journal+transcripts) | gzip | full world | world gzip | redacted view | view gzip | cold replay |
|---|---|---|---|---|---|---|---|
| 10 | 21 KB | 2 KB | 100 KB | 24 KB | 86 KB | 22 KB | 35 ms |
| 50 | 71 KB | 5 KB | 237 KB | 35 KB | 190 KB | 31 KB | 153 ms |
| 100 | 111 KB | 6 KB | 378 KB | 44 KB | 285 KB | 37 KB | 307 ms |

Bots write tiny journals; a played campaign carries model ops and diplomacy
transcripts and will be several times larger, but prose gzips 3–5x. Expect a
sealed blob in the **tens of KB**, well under Cloud Run's 32 MB request limit.

The journal is already the source of truth and the world is a pure function of
it. That is the whole reason this is feasible.

## The problem the obvious design walks into: fog of war

"Keep all state in the browser" with plaintext state breaks the game:

- **Fog.** `worldAsSeenBy` redacts rival orders, operatives, private log
  entries and Rim events. Prompts need the *unredacted* world. If the browser
  holds it, devtools shows every rival operative and secret programme — the
  layer the intel module exists for.
- **Integrity.** The server would apply ops against a world the client wrote.
  Anyone can hand it 99,999 credits. Replaying the journal on every request
  closes that only if the journal itself is trusted, and it is client-written
  too.
- **Dice.** `rollD20(turn, \`${stagedCount}:${action}\`)` is a pure function
  of things the client knows, and `checks.ts` already ships in the browser
  bundle. A player can search wordings offline for a natural 20.

## Recommended design: a sealed envelope

The browser holds the state but cannot read or edit it.

```
browser                                  Cloud Run (any instance)
  envelope (opaque bytes) ─── POST ───▶   open(envelope)  → Session snapshot
  + intent {text}                         run the existing engine
  ◀── streamed response ──────────────    progress… reaction… view, envelope'
  stores envelope' in IndexedDB           seal(snapshot') → envelope'
```

- **`seal` = gzip → AES-256-GCM** with a key from Secret Manager (compress
  *before* encrypting; ciphertext does not compress). GCM's tag is the
  integrity check: a tampered blob fails to open, so the server can trust it
  without replaying. Include a key id so the key can be rotated.
- **Contents**: the save file (journal, transcripts, epilogue), the committed
  world snapshot (trusted, so no 300 ms replay per request — parse is ~1.5 ms),
  staged batches, `actionsDeclared`, the open-channel fields, the last
  briefing, a per-campaign **secret dice seed**, and a monotonic `rev`.
- **The client additionally receives the redacted `CampaignView`** in
  plaintext, exactly as today. It renders that and never opens the envelope.
- **Dice**: mix the sealed seed into the salt. Journal it inside the seed entry
  so replay is unchanged; old journals without one replay as today.

### Where gzip actually goes

The user-facing question was whether to ship a gzip library to the client. You
don't need one:

- The envelope is compressed server-side before encryption. The client stores
  and returns opaque bytes and never compresses them.
- The **view** is the large plaintext payload (285 KB → 37 KB). Cloud Run does
  not compress responses for you, so the server should honour
  `Accept-Encoding` with `node:zlib`; the browser decompresses natively.
- If client-side compression is ever wanted (local export, or a plaintext
  request body), `CompressionStream('gzip')` is built into every current
  browser. No package.
- Send the envelope as raw `application/octet-stream`, or base64 in JSON
  (+33%). At these sizes either is fine; base64-in-JSON keeps `dispatch`
  unchanged.

### Code changes

1. **`Campaign` ↔ snapshot.** Add `toSnapshot()` / `fromSnapshot()` covering
   committed state, staged batches and `actionsDeclared`. `fromSaveFile`
   already shows the shape; the new part is staged state, which today is
   deliberately unsaved.
2. **`GameSession` becomes per-request.** Its fields move into the snapshot.
   `dispatch` becomes `open → construct session → route → seal`. The busy
   guard disappears; concurrency is handled by `rev` (see below).
3. **Replace SSE with a streamed response per POST.** `EventHub` assumes the
   event connection and the POST share a process. Instead the POST body itself
   streams NDJSON (`progress`, `reaction`, `state`, then a final `result` with
   the new envelope). `useGame.ts` swaps `EventSource` for reading
   `fetch().body`. Cloud Run streams HTTP/1.1 chunked responses fine; set the
   request timeout above the slowest turn (default 300 s is enough; end of turn
   measured at 9–76 s).
4. **Event flavour (`dressEvents`)** is fire-and-forget after the response. On
   Cloud Run CPU is throttled once the response ends (unless "CPU always
   allocated"), and the result has nowhere to go. Keep the stream open until
   it finishes and emit it as a final event, or make it a separate
   client-initiated request carrying the envelope.
5. **Store**: `CampaignStore` becomes a browser concern. Saves = envelopes in
   IndexedDB keyed by name; the saved-games list is client-side. Export can
   stay a server route (open envelope → `packCampaign`) — the tar archive is
   plaintext journal, which is fine because it is the player's own campaign
   and the fog was already crossed on export today. Import = server verifies
   (replays) and returns a sealed envelope.
6. **Server binding/auth**: bind `0.0.0.0:$PORT`. The 127.0.0.1 rule exists
   because the process spends money unauthenticated; on the internet that
   needs either IAP / Cloud Run IAM in front, or BYOK — the player's
   OpenRouter key sent per request (header, never sealed or logged). BYOK pairs
   naturally with the parallel OpenRouter work and with statelessness: nothing
   per-user is stored anywhere.
7. **Telemetry**: `FileSink` → a stdout JSON sink (Cloud Logging picks it up).
   `inFlight` is per-instance and only diagnostic.
8. **Container**: prompts are read from disk (`model/prompts.ts`) — copy
   `prompts/` into the image. The Claude Agent SDK path spawns a bundled
   binary and needs a subscription token; that should not be the hosted
   transport. Hosted = the HTTP provider the other branch is adding.

## What a stateless server cannot do

**Rollback.** The client can always resend an older envelope: decline a bad
roll, a refused accord, a lost battle, and replay from before it. Today
`StagedBatch.binding` exists precisely to stop discard-as-reroll. Options:

| option | cost | prevents |
|---|---|---|
| accept it | none | nothing — it's a single-player game; call it save-scumming |
| `rev` + a tiny head table (Firestore/Redis: `campaignId → rev`) | one KV read+write per mutating request | rollback and double-submit; still no game state server-side |
| full server-side storage | a database | everything, and you're no longer stateless |

The head table is the honest middle: the server stores 30 bytes per campaign,
not the campaign. Without it, at least use `rev` to make the client reject a
stale response from a double-click.

## Alternative considered: run the engine in the browser

`src/domain` is pure and already shared with the client, so the reducer could
run client-side with the server reduced to a model proxy. Rejected: the server
must see the unredacted world to build prompts anyway, the client would see it
too (no fog), and the server would be applying ops to a world it cannot trust.
The sealed envelope keeps the engine server-side for the same price.

## Order of work

1. Snapshot round-trip for `Campaign` + session fields, with a test that a
   campaign mid-turn (staged actions, open channel) survives seal/open
   byte-identically and still `verifyReplay`s.
2. Per-request session behind the existing `dispatch` seam, still on
   localhost — playable without Cloud Run.
3. Streamed POST responses; retire `EventHub`.
4. IndexedDB saves, response compression, secret dice seed.
5. Dockerfile, `0.0.0.0:$PORT`, stdout telemetry, auth (BYOK or IAP).
6. Decide rollback policy.
