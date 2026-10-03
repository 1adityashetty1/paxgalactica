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

> [!WARNING]
> **Set a credit limit on the key before you deploy.** The service below is
> public and the game has no login, so anyone who finds the URL plays on your
> key. Nothing in the game can stop that spend for you: the limit you set on
> the key at your provider is the only real budget. Use a key made for this
> deployment and nothing else, with a limit you would be comfortable losing.
>
> - **OpenRouter:** open Settings → Keys, edit the key, and set its credit
>   limit.
> - **Anthropic:** set a spend limit on the workspace the key belongs to in
>   the Console.

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

# 3. Deploy. Public: anyone with the URL can play, on your key.
gcloud run deploy paxgalactica \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --set-env-vars PAXGALACTICA_PROVIDER=openrouter,PAXGALACTICA_SPEND_CAP=10 \
  --set-secrets OPENROUTER_API_KEY=openrouter-api-key:latest \
  --timeout 600 \
  --memory 1Gi \
  --max-instances 3
```

Play at the URL the deploy prints.

For an Anthropic key, use `PAXGALACTICA_PROVIDER=anthropic` and
`ANTHROPIC_API_KEY` instead. Rotating the key means adding a new secret
version and redeploying, or waiting for new instances, since `:latest` is
read at instance start.

### Why it's set up that way

- **Public, with no auth, by decision.** The key's credit limit is what
  protects you. To keep it private instead, deploy with
  `--no-allow-unauthenticated` and play through
  `gcloud run services proxy paxgalactica --region "$REGION"` at
  `http://localhost:8080`.
- **`PAXGALACTICA_SPEND_CAP` from #52 is not a budget here.** It counts spend
  in each instance's memory, so every instance has its own total and it resets
  whenever an instance is replaced. At most it's a per-instance tripwire, and
  `--max-instances` bounds how many there are.
- **The settings screen is open to anyone who reaches the server.** #52's
  `POST /api/settings` has no auth and writes `~/.paxgalactica/settings.json`
  on whichever instance served it, and every model call re-reads that file.
  With `PAXGALACTICA_PROVIDER` set, a visitor cannot change the provider, but:
  - **model overrides** have no environment variable, so the file always wins.
    A visitor can point the tiers at a far pricier model, billed to your key,
    or at one that does not exist and break the game. The key's credit limit
    is the only bound on this.
  - **a stored key beats the env key.** A visitor's own key would then pay for
    everyone on that instance, and see their prompts.
  - **the spend cap** can be removed or set to 0 unless
    `PAXGALACTICA_SPEND_CAP` is set in the environment, so set it.

  Each change lasts only on that instance until it is replaced. The fix is a
  follow-up: refuse settings changes when `PAXGALACTICA_PROVIDER` comes from
  the environment, and show the panel read-only.
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
