# Running on Cloud Run

The server is stateless: the browser holds the campaign and sends it with
every request. Any instance can serve any request, and an instance can vanish
between two of them. The design is in CLAUDE.md under *"The server is
stateless; the browser holds the campaign"*; this file covers deployment and
what was measured.

## Deploy

```bash
gcloud run deploy paxgalactica \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --timeout 600 \
  --memory 1Gi
```

- **No auth yet, by decision.** `--allow-unauthenticated` with no login means
  anyone with the URL spends your model budget. Restrict it with Cloud Run
  IAM or IAP until auth exists.
- **Model credentials** come from the OpenRouter work on its own branch. Until
  that lands, the image only starts with `PAXGALACTICA_SKIP_PREFLIGHT=1`, and
  model calls fail with `not_authenticated`. The Claude Code binary path wants
  a subscription token on disk, which is not a fit for a hosted server.
- **`--timeout`.** End of turn is up to ~80 s with reactions, and the response
  stays open for the event-flavour call. 600 s is generous.
- **Concurrency** can stay at the default. Requests share nothing but module
  globals that are diagnostic only (the telemetry sink and its in-flight
  counter).

The image sets `PAXGALACTICA_HOST=0.0.0.0` and `PAXGALACTICA_STORE=memory`,
and listens on `$PORT`.

| env | default | |
|---|---|---|
| `PAXGALACTICA_HOST` | `127.0.0.1` | `0.0.0.0` in the image |
| `PAXGALACTICA_PORT` / `PORT` | 4173 | Cloud Run sets `PORT` |
| `PAXGALACTICA_STORE` | `file` | `memory` writes no `saves/` mirror |
| `PAXGALACTICA_SKIP_PREFLIGHT` | unset | `1` starts without a model credential |
| `K_REVISION` | set by Cloud Run | the build id a snapshot is trusted under |

## Verified

- Two containers from the image, with requests alternated between them for one
  campaign: start on A, end turn on B, end turn on A, read on B. All 200, turn
  advancing correctly.
- Gzip both ways over curl: ~18–23 KB a request over the first three turns.
- Save → load: the archive carries `session.json`, and loads on a request with
  no session.
- `tests/stateless.test.ts`: round trip, mid-turn, another build's snapshot
  replayed, an unreadable session, an open channel, save files, the
  `pnpm resume` boot hand-off.
- **Not verified in a browser.** No browser was available in the session that
  built this. The client compiles under `typecheck:web`, and the transport it
  speaks was exercised with curl. The first thing to check by hand is a full
  turn in the UI, a reload mid-turn, and Save / Load.

## Sizes

`scripts/stateless-probe.mjs`, 100 turns with bots playing every power (no
model calls):

| turn | save (journal+transcripts) | gzip | full world | world gzip | redacted view | view gzip | cold replay |
|---|---|---|---|---|---|---|---|
| 10 | 21 KB | 2 KB | 100 KB | 24 KB | 86 KB | 22 KB | 35 ms |
| 50 | 71 KB | 5 KB | 237 KB | 35 KB | 190 KB | 31 KB | 153 ms |
| 100 | 111 KB | 6 KB | 378 KB | 44 KB | 285 KB | 37 KB | 307 ms |

A played campaign carries model ops and diplomacy transcripts and will be
several times larger. Prose gzips 3–5x, so expect requests in the tens of KB,
well under Cloud Run's 32 MB limit. The cold replay is why the committed world
rides in the snapshot: from the same build it is parsed (~1.5 ms) instead of
rebuilt.

## Known gaps

- **Telemetry** writes `saves/<name>.trace.jsonl` only with the file store. On
  Cloud Run there is no trace until a stdout sink is added for Cloud Logging.
- **`Resume from this server's saves/`** on the title screen is empty under
  the memory store. Saves are the player's files now.
- **Two tabs** on one browser share the IndexedDB session and do not
  coordinate. The last one to finish a call wins.
