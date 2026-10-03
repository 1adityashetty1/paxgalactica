# Running on Cloud Run

The server is stateless: the browser holds the campaign and sends it with
every request. Any instance can serve any request, and an instance can vanish
between two of them. The design is in CLAUDE.md under *"The server is
stateless; the browser holds the campaign"*; this file covers deployment and
what was measured.

## Deploy with an OpenRouter key

This needs PR #52 (`claude/provider-seam`), which adds the keyed providers.
On a server the key comes from the **environment**, held in Secret Manager.
Don't use the settings screen there; see the caveats below.

```bash
PROJECT=$(gcloud config get-value project)
REGION=us-central1

# 1. Store the key once.
printf %s "$OPENROUTER_API_KEY" | gcloud secrets create openrouter-api-key --data-file=-

# 2. Let Cloud Run's runtime service account read it.
NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
gcloud secrets add-iam-policy-binding openrouter-api-key \
  --member "serviceAccount:${NUMBER}-compute@developer.gserviceaccount.com" \
  --role roles/secretmanager.secretAccessor

# 3. Deploy. Private: only principals with roles/run.invoker can reach it.
gcloud run deploy paxgalactica \
  --source . \
  --region "$REGION" \
  --no-allow-unauthenticated \
  --set-env-vars PAXGALACTICA_PROVIDER=openrouter \
  --set-secrets OPENROUTER_API_KEY=openrouter-api-key:latest \
  --timeout 600 \
  --memory 1Gi \
  --max-instances 3

# 4. Play, through an authenticated tunnel, at http://localhost:8080
gcloud run services proxy paxgalactica --region "$REGION"
```

For an Anthropic key, use `PAXGALACTICA_PROVIDER=anthropic` and
`ANTHROPIC_API_KEY` instead. Rotating the key means adding a new secret
version and redeploying, or waiting for new instances, since `:latest` is
read at instance start.

### Why it's set up that way

- **`--no-allow-unauthenticated` plus `services proxy`** is the auth for now.
  The game has no login, so a public URL would let anyone spend your key. The
  proxy tunnels your own gcloud credentials to the service, and the browser
  only ever talks to `localhost`. To let someone else play, grant them
  `roles/run.invoker`.
- **Use OpenRouter's per-key credit limit as the real budget.** Set it on the
  key's page in OpenRouter. `PAXGALACTICA_SPEND_CAP` from #52 counts spend in
  process memory, so on Cloud Run each instance has its own total and it
  resets whenever an instance is replaced. It is a per-instance tripwire, not
  a budget. `--max-instances` bounds how many tripwires there are.
- **Don't enter keys on the settings screen of a hosted server.** #52 stores
  a key entered there in `~/.paxgalactica/settings.json` on whichever instance
  served the request, and a stored key wins over the environment. So different
  instances would disagree, and anyone who can reach the server could replace
  the key. A follow-up should make the settings screen read-only when
  `PAXGALACTICA_PROVIDER` comes from the environment.
- **`--timeout 600`.** End of turn takes up to ~80 s with reactions, and the
  response stays open for the event-flavour call.
- **Concurrency** can stay at the default. Requests share nothing but module
  globals that are diagnostic only.
- **`PAXGALACTICA_SKIP_PREFLIGHT`** was only needed before #52, which makes
  preflight warn rather than abort. Once both PRs are in, the hosted deploy
  doesn't need it.

The image sets `PAXGALACTICA_HOST=0.0.0.0` and `PAXGALACTICA_STORE=memory`,
and listens on `$PORT`.

| env | default | |
|---|---|---|
| `PAXGALACTICA_PROVIDER` | subscription | `openrouter` or `anthropic` (#52) |
| `OPENROUTER_API_KEY` / `ANTHROPIC_API_KEY` | unset | from Secret Manager (#52) |
| `PAXGALACTICA_SPEND_CAP` | unset | per-instance tripwire, in USD (#52) |
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
