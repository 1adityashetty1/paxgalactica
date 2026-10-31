---
name: bughunt
description: Run the bug-hunt loop on Pax Galactica — play a short campaign against the live server, scan it for bugs, validate each one with a failing test, fix it, gate, and push to the branch's open PR, round after round until a round finds nothing worth fixing. Use when asked to playtest for bugs, run a bug hunt, or "do another playtest".
---

# The bug-hunt loop

One **round** is: play → scan → triage → validate → fix → gate → push. Rounds
repeat until the **end condition** below. Everything a round touches is in
this repo: `scripts/pt.mjs` drives the server, `scripts/bughunt-scan.mjs`
finds the mechanical bugs, `scripts/bughunt-gate.mjs` decides whether a round
may be pushed.

## Before the first round

1. **The PR.** `gh pr view --json number,state,url,headRefName` on the current
   branch. If it reports an open PR, rounds push to it. If there is none, ask
   the user once whether to open one from the current branch — pushing and
   opening a PR are outward-facing — and do not push until they say. Never
   enable auto-merge.
2. **The baseline.** `node scripts/bughunt-gate.mjs --record` writes each
   `saves/bughunt*` save's replay-rejection count. The gate holds every later
   round to it.
3. **The server.** `preview_start` with `{name: "paxgalactica"}` (it runs
   `pnpm serve`, which builds). Restart it after any source change that should
   be live for the rest of the round; a running server keeps the old build.

## A round

### 1. Play (about 4 turns, 2 actions a turn)

- **Rotate the faction**: the one played least recently among meridian, vigil,
  ojjul, freeworlds, drajk (`ls saves/bughunt*` and `docs/playtest-*`).
- **New campaign**: `PT_SESSION=saves/<name>-session.json node scripts/pt.mjs
  new <faction> 12 <name>`, with `<name>` = `bughunt<N>`, the next unused N.
- **Every call with `--digest`** (`node scripts/pt.mjs act "…" --digest`),
  which prints the narrative, check, notes, rejections, ops, reactions and
  battles in a dozen lines. Read each one for bugs as it comes.
- **Aim at coverage**, not at winning: each round should exercise at least one
  each of a declared order, a covert mission, a negotiated accord (talk, then
  endtalk), and an end turn with reactions. Prefer whatever the last two
  `docs/playtest-*.md` did not touch — recent code is where bugs are.
- **Write candidates down as they happen** — turn, what was said, what landed —
  in a scratch list. The scan finds shapes; only reading finds a story that
  contradicts the board, a persona misstating a rule, or a ruling that inverts
  a line.

### 2. Scan

`pnpm -s build && node scripts/bughunt-scan.mjs <name>` (add `--json` to
consume it). It replays the save with no model calls and reports, by severity:
raw ids, plurals, possessives, `null`/`undefined` in text, spliced sentences,
"X at X at X", stale all-or-nothing notes, rejections by code, double
payments, drift compulsions charged on an act, losses on a failed check,
failed model calls, and gaps in the trace. Merge its findings into the list.

### 3. Triage

Give every candidate one class:

| class | means | action |
|---|---|---|
| **code** | the engine did the wrong thing, or said it wrongly | fix |
| **prompt** | a model was told something wrong, or not told something it needed | fix the prompt, **and** a code guard where code can know the answer (a lookup, a direction, an id) — a prompt-only fix is verified live before it counts |
| **model** | a model chose badly where nothing could have told it better | note, don't fix |
| **design** | the rule itself is in question | stop and ask the user — see the end condition |

Severity: **serious** (money, territory, standing or dissent wrong; a deal not
enforced; a leak of private state), **minor** (the player misled or an action
wasted), **cosmetic** (wording).

### 4. Validate, then fix

For each **code** or **prompt** candidate, serious first:

1. **Reproduce it in a test that fails** — the existing test file for that
   area, the scripted-model pattern (`vi.mock('../src/model/client.js')` with a
   per-kind queue, as in `tests/reconcile.test.ts`) for anything behind a model
   call. Run it and see it fail. A candidate that cannot be made to fail is
   **not validated**: drop it, or note it under "Noted, not fixed".
2. Fix it the way the surrounding code does (CLAUDE.md is the reference: code
   owns numbers and lookups, the model owns judgement).
3. The test passes. Anything that changes how an old journal replays is pinned
   to a new `JOURNAL_VERSION` with a `LegacyRules` flag.

Cosmetic findings from the scan need no failing test when the scan itself is
the reproduction: re-run the scan and see the finding gone.

### 5. Gate

`node scripts/bughunt-gate.mjs` — three typechecks, the suite, and every
bug-hunt save replaying with no more rejections than the baseline. A failure is
fixed before anything is pushed. Then `--record` again so the next round's
baseline includes this round's save.

### 6. Record and push

- `docs/playtest-<date>-<faction>.md` in the format the earlier ones use: what
  was played, a **Fixed** table (found → fix), and **Noted, not fixed**.
- CLAUDE.md where a fix changes a documented rule (a sentence or a paragraph in
  the section that owns the rule, not a changelog).
- One commit per round: `Bug hunt <date> (<nth>): <n> fixes from a <faction>
  playtest`, with the attribution line. Push to the PR branch. Never commit
  `.claude/launch.json`.

## End condition

Stop after the round in which **any** of these holds, and report:

1. **Dry round** — the round validated no serious or minor bug (cosmetic only,
   or nothing). Two rounds in a row with only cosmetic fixes also ends it.
2. **Cap** — 5 rounds, or the model spend across the loop's traces passes $20
   (the scan prints each campaign's spend).
3. **Decision needed** — a **design** candidate, or a fix that would change
   balance (`pnpm balance 30` board) or a rule CLAUDE.md states as deliberate.
   Stop before fixing it and put the question to the user.
4. **Red gate** — the gate cannot be made green within the round.

The report: one line per round (faction, fixes by severity, spend), what was
pushed and where, and the open items carried in "Noted, not fixed".

## Standing rules for this repo

- Officers, operatives and notables are they/them, in prose and in fixes.
- Counsellor (advisor) mistakes are not bugs to chase in a playtest.
- New art needs the user's approval before it is committed.
- No unactionable asides in the report.
