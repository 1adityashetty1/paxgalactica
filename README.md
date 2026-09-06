# Pax Galactica

An LLM-driven grand strategy campaign in a lawless outer rim, played in your
browser on localhost. Twenty-five systems, four sectors, five powers who will
not shut up about their principles.

You type what you want to do in plain English. A model decides what actually
happens — but it never touches the world directly: it emits typed operations
that a pure reducer validates and applies. Dice are rolled in code before the
model is asked anything, so nobody can talk their way into a good roll.

**Runs on a Claude Pro or Max subscription.** No API key, no per-token billing
set-up.

> **Early build.** A declared action takes about **30 seconds** to resolve, and
> a ten-turn campaign costs roughly **$3** of subscription usage. Measured, not
> estimated.

---

## Quick start

```bash
git clone <your-fork> paxgalactica
cd paxgalactica
./start
```

That is the whole thing. `./start` checks your Node version, installs pnpm via
corepack if you do not have it, installs dependencies, **verifies your Claude
Pro/Max subscription with a real model call**, then builds and launches the
game in your browser. If you are not signed in it offers to do that first.

The subscription check is a live call rather than a file check on purpose: the
binary reports `loggedIn=true` for a token that was truncated on paste, and an
API key in your shell would otherwise look like success. It probes with the
API-key variables stripped and the stored token injected — exactly the
environment the game itself uses — and rejects `api_key` as the method.

It is plain POSIX `sh` and does nothing you could not do by hand — it exists
for the one bootstrap step that cannot be written in Node: telling you your
Node is too old. Without it a fresh clone fails somewhere inside Vite with an
error that never mentions the version.

If something is wrong and you want to know what:

```bash
pnpm doctor
```

That checks Node, pnpm, dependencies, the bundled Claude binary, your stored
token, a live model call, and whether the port is free — and prints the exact
command to fix anything it finds.

---

## Requirements

| | |
|---|---|
| **A Claude Pro or Max subscription** | This is the only supported auth. See below. |
| **Node** | `^20.19` or `^22.12` or `>=24` — Vite sets the floor |
| **pnpm 11** | `./start` enables it for you via corepack |
| **macOS or Linux** | Developed and verified on macOS. Should work on Linux; Windows is untested. |

There is no Python, no Docker, no database, and no build toolchain beyond Node.
Four runtime dependencies in total.

---

## Setup by hand

If you would rather run the steps yourself:

```bash
pnpm install
pnpm login      # sign in with your Pro/Max account
pnpm auth       # verify, with one real model call
pnpm play:web   # build, serve on 127.0.0.1:4173, open the browser
```

### Sign in

```bash
pnpm login
```

This runs `claude setup-token` against the Claude Code binary bundled with the
Agent SDK. A browser opens; approve access with your Pro/Max account. The
command prints a token starting `sk-ant-oat…`, which is captured and stored at
`~/.paxgalactica/oauth-token` (mode `0600`, outside the repo so it cannot be
committed).

**The token usually wraps across two terminal lines.** If you are pasting it by
hand, paste *all* of it — a truncated token stores cleanly and then fails with a
`401`, which is the most confusing outcome available. `pnpm login` rejoins the
lines for you and warns if what it got looks too short.

### Confirm it worked

```bash
pnpm auth
```

This makes **one real Haiku call**, so a `✓` means the credential genuinely
works — not merely that a file exists. You want:

```
✓ Subscription auth working — a live model call succeeded.
```

### Play

```bash
pnpm play:web
```

Builds both halves, starts the server on `http://127.0.0.1:4173`, and opens your
browser. `Ctrl-C` saves the campaign and exits.

---

## About authentication

This is the part most likely to waste your afternoon, so it is worth reading
once.

### `claude auth login` is not enough

The obvious command stores its credential in the macOS keychain — and on some
machines that write **silently does nothing**. You get an account profile in
`~/.claude.json`, no keychain entry, no error, and every model call afterwards
reports "not logged in" forever.

`pnpm login` avoids the keychain entirely: `setup-token` mints a long-lived
subscription token, and the game injects it as `CLAUDE_CODE_OAUTH_TOKEN` on
every call. Deterministic, and independent of whatever your keychain is doing.

### `CLAUDE_CODE_OAUTH_TOKEN` is not an API key

Three similar-looking variables, doing different things:

| variable | what it is |
|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | **subscription** auth — what this game uses |
| `ANTHROPIC_API_KEY` | API-account billing, per token |
| `ANTHROPIC_AUTH_TOKEN` | also API-account billing |

### An `ANTHROPIC_API_KEY` in your shell is harmless

If you have one exported from `~/.zshrc` — many people do — **you do not need to
unset it for anything.** Every path strips it:

- `buildAuthEnv()` in `src/model/auth.ts` deletes both API-key variables from
  the environment handed to the binary and injects your subscription token, so
  a stray key can neither shadow the subscription nor bill an API account.
- `pnpm login` strips them before running `setup-token`, so it cannot bind to
  the wrong account.
- `pnpm auth` strips them before probing, so it reports what the *game* will
  see rather than what your shell happens to have.

`pnpm auth` prints a one-line note when it finds one, then carries on. Verified:
with a bogus `ANTHROPIC_API_KEY` exported, `pnpm auth` still reports
`✓ Subscription auth working`.

> **Want to run on an API key instead?** Not supported today — API keys are
> stripped, by design, so a stray shell variable cannot quietly bill an account.
> Making it opt-in would be a small change to `buildAuthEnv()` and
> `assertLoggedIn()`, but it is deliberately not the default.

---

## Playing

Type what you want to do. Anything. The model decides what is possible.

**Declarations land on the next turn.** Typing an action resolves it and shows
you the outcome, but nothing changes until you press **End turn** — which is
also when the other powers respond, to the whole settled turn rather than to
each move.

| command | |
|---|---|
| *(free text)* | declare an action |
| `:endturn` | land everything, hear the powers respond, advance time |
| `:discard` | clear what you have declared |
| `/talk <faction>` | open a diplomatic channel (or click **talk**) |
| `/endtalk` | close it — only now is anything you agreed made real |
| `:export` | download the campaign as a `.tar.gz` (or the **Export** button) |
| `:help` | commands, what each stat governs, how checks resolve |

### Three things that surprise people

**An arbiter rules before anything is rolled.** Declare something the game has
no mechanic for — a dynastic marriage, an exclusive charter — and a referee
decides whether it can be attempted at all, what it tests, and whether it
creates something lasting. It is deliberately not told the die roll, so it
cannot price an action to the result it wants. Marry into one house and the
second offer is refused, by name, because the first is recorded in world state
rather than in a model's memory.

**Your own faction can refuse you.** Order the Meridian Trade Authority to run
narcotics and the Trade Council votes it down. Order the Iron Vigil to stand down
every patrol and the fleet commanders read it as complicity. Each power has red
lines it will not cross and compulsions it insists on. Nothing is staged when
they refuse.

**Nothing said in a diplomatic channel changes the world.** A faction can
promise you anything. Only when you close the channel does a separate pass read
the transcript and enact what was *actually agreed* — and it is deliberately
strict: a rejected offer, an unanswered offer, and a conditional promise all
produce nothing.

**Unaligned is not undefended, and occupying is not owning.** Neutral worlds
carry garrisons and fight a landing like anyone else — there are no free pickups
on this map. But parking ships over one collects its income without a shot
fired, and without giving you the world. The same trick works on a rival's
system, which is why a fleet in orbit is an economic act.

**Ships cost money and keep costing it.** A hull is 60 credits and 4 a turn
forever after, against a net income of 87–300. Order a thousand ships and the
yards deliver the eighteen you paid for. Build past your income and the unpaid
crews are stood down, a slice at a time, until the fleet fits the treasury.

---

## Saving and moving a campaign

Press **Export** in the topbar (or type `:export`) to download the whole
campaign as a `.tar.gz`. It holds the complete ops journal, so it is not a
snapshot — it is the campaign, replayable from turn 0.

Pick it up anywhere:

```bash
pnpm resume ~/Downloads/mycampaign-2026-08-09-14-02.tar.gz
```

That verifies the archive by replaying every op in it, installs it into
`saves/`, and starts the server with the campaign loaded. `--inspect` reports
what a file contains without writing anything; `--as <name>` avoids colliding
with a save you already have.

Actions you have declared but not landed are **not** in the archive — they are
not in the journal either. End the turn first if you want to keep them.

---

## Cost

Measured, not estimated:

| | |
|---|---|
| one resolution call | ~$0.02 |
| a full turn (one action + reactions) | ~$0.12, about 42 seconds |
| ten turns | roughly $1 |

Reactions are one call per **turn**, not per action — declaring four things
costs four resolutions and one reaction. Model tiering lives in one file
(`src/model/router.ts`) if you want to move work to Haiku.

---

## Troubleshooting

| symptom | cause and fix |
|---|---|
| `pnpm: command not found` | `corepack enable pnpm` |
| `pnpm login` produces no token | Run `claude setup-token` directly (path printed in the error), then `pnpm save-token <token>` |
| `pnpm auth` says `401 OAuth access token is invalid` | Usually a truncated paste. Check the length it reports — a full token is ~108 characters. Re-run `pnpm login`. |
| `pnpm auth` says `✗ No subscription token stored` | `pnpm login` has not completed successfully yet. |
| Server refuses to start, mentions signing in | Auth is checked at startup on purpose, so you find out now rather than on your first action. |
| Browser shows "Cannot reach the game server" | The server exited. Check the terminal running `pnpm play:web`. |
| A change to the client does not appear | Vite **does not typecheck**. Run `pnpm typecheck:web`, then rebuild. |
| Port 4173 is taken | `PAXGALACTICA_PORT=5000 pnpm play:web` |

The server binds to `127.0.0.1` only and has no authentication, because it is a
single-player game on your own machine — which is exactly why it must not be
reachable from your network.

---

## Commands

| | |
|---|---|
| `pnpm play:web` | build, serve, open the browser |
| `pnpm serve` | server only (pair with `pnpm dev:web` for HMR) |
| `pnpm dev:web` | Vite dev server, proxying `/api` to 4173 |
| `pnpm login` / `pnpm auth` | sign in / verify with a real call |
| `pnpm save-token <token>` | store a token by hand |
| `pnpm test` | 238 tests, no network |
| `pnpm typecheck` / `typecheck:web` | the two tsconfigs |
| `./start` | clone-to-playing: checks Node, installs, signs in, launches |
| `pnpm doctor` | diagnose a broken setup; prints the fix for anything it finds |
| `pnpm replay <name>` | rebuild a saved campaign from its journal, no model calls |
| `pnpm resume <file>` | verify an exported archive, install it, and serve it |

`pnpm replay` is worth knowing about: every campaign is stored as its journal of
operations, so any save can be rebuilt from turn 0 deterministically, without
calling a model. That is what makes prompt changes evaluable — replay the same
journal before and after an edit and compare the worlds.

---

## How it works

[CLAUDE.md](CLAUDE.md) documents the architecture: the op vocabulary, the
duration rules, the ability-check system, faction character, the economy, and
the client/server split. Short version:

- **The model never rewrites state.** It emits typed ops; `applyOps` — pure,
  heavily tested — is the only thing that mutates the world.
- **Code owns the numbers, prompts own the interpretation.** Dice, movement
  costs, duration floors, and agent success chances are all computed in code and
  handed to the model, which cannot argue with them.
- **Everything is deterministic.** No `Math.random()`, no clocks. Rolls are
  seeded from the turn number, so a campaign replays identically.
