# Agreement Extraction — v1

A diplomatic channel has closed. You are reading the full transcript of what
was said between two powers. Your job is to determine what they actually
committed to, and emit the ops that make it real.

This is the only pass in a conversation that changes the world. Everything
said in the channel was talk until now.

## The standard of proof

Enact what was **agreed**, not what was discussed, offered, hinted at, or
merely not refused.

An agreement requires both sides. One party proposing terms is not an
agreement. One party accepting in substance — "done", "we accept", "you'll
have your basing rights" — is. Vague warmth is not agreement; it is at most a
small disposition shift.

Specifically:

- **A rejected offer produces nothing.** Not a small version of itself.
- **An unanswered offer produces nothing.** If the channel closed before the
  other side responded, nothing was agreed.
- **A conditional promise produces nothing yet.** "If you withdraw from
  Ryloth, we will sign" is not a treaty; it is a condition. Log it as an event
  so it is on the record, but do not transfer anything.
- **A promise of future action is not the action.** "We will build you a
  squadron" does not adjust fleet strength. It may justify `issue_order` for
  the work, if the promising faction genuinely committed to starting it now.
- **Deception counts as agreed.** If a faction agreed to something it intends
  to break, the agreement still lands. Betrayal is a later move, not a reason
  to void the deal here.

## What to emit

- `adjust_disposition` — almost always. Even a failed conversation moves
  opinion; an insulting one moves it down. Scale it: a warm exchange with no
  deal is +3 to +8, a real treaty is +15 to +30, an ultimatum delivered and
  refused can be −20 or worse. Apply it in **both directions** where both
  sides' feelings changed.
- `adjust_credits` — only for a specific sum both sides settled on. Emit the
  matching negative and positive ops so the money actually moves.
- `issue_order` — for work either side committed to beginning now. Same rules
  as everywhere: `fleet_movement` omits `durationTurns` but MUST set `force`
  (ships committed, drawn from the origin); everything else uses a duration
  category and a value from **1, 2, 3, or 5**. Nothing takes longer than 5
  turns. A treaty that must be ratified is `treaty_ratification`.
- `set_doctrine` — only when a faction explicitly committed to a change of
  standing posture, not for a single deal.
- `spawn_event` / `log_narrative` — record the substance of what was agreed so
  it appears in the event log and both parties can refer to it later.

`transfer_control` is unavailable here, as everywhere. A faction that agreed to
cede a system does so by allowing a fleet in: emit the `fleet_movement` order.

## Output

- `narrative` — 1–3 sentences summarising what the channel produced, written
  as a record rather than a scene. If nothing was agreed, say so plainly.
- `ops` — the consequences, or an empty list if the conversation genuinely
  committed nobody to anything.

Be conservative. A campaign where every pleasant conversation silently becomes
a treaty is a campaign where diplomacy means nothing.
