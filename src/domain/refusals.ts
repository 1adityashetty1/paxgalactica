import { familyOf, resolvePerson } from './command.js';
import { SWAY_BY_BAND } from './acts.js';
import type { RefusalGround } from './ops.js';
import { hullsAt, type WorldState } from './state.js';

/**
 * Refusals the arbiter makes up, and the ops covert work may carry.
 *
 * Two held-out playtests (2026-10-16) watched the arbiter refuse covert acts
 * with rules that exist nowhere: "not a sparrow's mission", "there is no
 * mechanic for relocation", "cannot be reassigned mid-mission". The prompt says
 * in bold that none of these is a reason, and it did not hold twice, so the
 * check is made here: a refusal whose reason is one of these is not a ruling.
 */

/** Why a refusal is not a ruling, or null when it may stand. */
export type InventedRefusal = 'class' | 'no_mechanic' | 'reassign';

const CLASS_WORD = /\b(ghosts?|agitators?|sparrows?|wetworkers?)\b/i;
const CLASS_GATE =
  /\b(mission|missions|class|trained|suited|speciali[sz]\w*|not (?:a|an|the|their|its)\b|only\b|outside\b|isn'?t|cannot|can'?t)\b/i;
const NO_MECHANIC =
  /\bno (?:game |engine )?(?:mechanic|mechanism|rule|op|operation|procedure|system)s? (?:for|to|that|covers?|exists?)\b|\bno (?:way|means) to (?:represent|model|express)\b|\bnot (?:modell?ed|represented|supported|expressible)\b|\b(?:engine|game|rules?) (?:has|have|offers?|provides?|supports?) no\b|\bno such (?:mechanic|mechanism|op|mission)\b|\bno mechanic\b/i;
const REASSIGN =
  /\bmid-?mission\b|\b(?:re-?assign|re-?task)(?:ed|ing)?\b|\balready (?:on|assigned to|committed to|engaged in) (?:a|an|another|its|their) (?:mission|operation|job)\b/i;

/**
 * Is this refusal one of the rules the arbiter keeps inventing?
 *
 * A class word alone is not enough — "your sparrow at Kalzir was caught" is a
 * fact — it has to be used as a gate. Ordered so the reason reported is the
 * likeliest one when a sentence says two.
 */
export function inventedRefusal(reason: string | undefined | null): InventedRefusal | null {
  if (!reason) return null;
  if (CLASS_WORD.test(reason) && CLASS_GATE.test(reason)) return 'class';
  if (/\bclass(?:es)?\b/i.test(reason) && /\b(operative|agent|spy)s?\b/i.test(reason)) return 'class';
  if (REASSIGN.test(reason)) return 'reassign';
  if (NO_MECHANIC.test(reason)) return 'no_mechanic';
  return null;
}

/** What the retry is told about the rule it broke, in the arbiter's terms. */
export const INVENTED_REFUSAL_NOTE: Record<InventedRefusal, string> = {
  class:
    "Your ruling refused this because of the operative's class. Class is never a gate: any operative may attempt any mission, and the engine adjusts their odds for it.",
  no_mechanic:
    'Your ruling refused this because "there is no mechanic". That is never a reason. Read the act by its outcome: if a mission produces it, put it in `covert`; if one only prepares for it, in `groundwork`; if none produces it, rule it admissible and put the outcome in `unexpressed`.',
  reassign:
    'Your ruling refused this because the operative is already on a mission. That is false: an operative on a mission is re-tasked by naming them, and the new mission replaces the old.',
};

/**
 * The ops a covert declaration may carry once the arbiter has ruled it covert.
 *
 * Covert work is sent, not rolled: the operative's own chance, method and
 * groundwork are rolled on the tick. Everything a send costs is charged in code
 * (`AGENT_COST`, the method's price) and groundwork costs the action alone, so a
 * resolution call has nothing to add but the sending and the story. A playtest
 * watched it invent fees on free groundwork, charge deployments twice and
 * extend a rival's programme with no presence; none of those is in this list.
 */
export const COVERT_SEND_OPS: ReadonlySet<string> = new Set([
  'deploy_agent',
  'lay_groundwork',
  'recall_agent',
  'log_narrative',
]);

/** Keep only the ops a covert send may carry, and say what was left out. */
export function covertSendOnly(ops: readonly unknown[]): { ops: unknown[]; dropped: string[] } {
  const kept: unknown[] = [];
  const dropped: string[] = [];
  for (const op of ops) {
    const kind = (op as { op?: unknown } | null)?.op;
    if (typeof kind === 'string' && COVERT_SEND_OPS.has(kind)) kept.push(op);
    else dropped.push(typeof kind === 'string' ? kind : 'unknown');
  }
  return { ops: kept, dropped };
}

/**
 * Keep a resolution call's sends only where the arbiter ruled one.
 *
 * Sending an operative and laying groundwork are the ruling's to decide: a
 * covert part names the mission and the world, a groundwork part the world, and
 * the engine writes the send from that (`routeCovertAction`). A resolution call
 * may fill in the details of a send the ruling made — the cover, the effect —
 * and nothing else. A playtest (2026-10-16) watched a retried ruling leave out
 * its covert part, and resolution place the assassin itself on the rolled path.
 */
export function sendsAsRuled(
  ops: readonly unknown[],
  covert: readonly { mission: string; systemId: string }[],
  groundwork: readonly { systemId: string }[],
): { ops: unknown[]; dropped: string[] } {
  const missions = new Set(covert.map((c) => `${c.mission}@${c.systemId}`));
  const places = new Set(groundwork.map((g) => g.systemId));
  const kept: unknown[] = [];
  const dropped: string[] = [];
  for (const op of ops) {
    const o = op as { op?: string; mission?: string; systemId?: string } | null;
    if (o?.op === 'deploy_agent' && !missions.has(`${o.mission}@${o.systemId}`)) {
      dropped.push(`a ${o.mission ?? 'covert'} send at ${o.systemId ?? 'an unnamed world'}`);
      continue;
    }
    if (o?.op === 'lay_groundwork' && !places.has(o.systemId ?? '')) {
      dropped.push(`groundwork at ${o.systemId ?? 'an unnamed world'}`);
      continue;
    }
    kept.push(op);
  }
  return { ops: kept, dropped };
}

/**
 * Prizes are the ruling's, as sends are: a resolution call may mint a thing only
 * of a kind the arbiter named in the overt part's `yields`, before the roll. A
 * prize invented after the roll, by the pass with every reason to be generous,
 * was how routine court acts at DC 5 produced sellable charts and contraband
 * (playtest 2026-10-15, A10). The band still sizes it (`boundPayloadsToOutcome`).
 */
export function prizesAsRuled(
  ops: readonly unknown[],
  yields: readonly string[],
): { ops: unknown[]; dropped: string[] } {
  const named = new Set(yields);
  const kept: unknown[] = [];
  const dropped: string[] = [];
  for (const op of ops) {
    const o = op as { op?: string; kind?: string } | null;
    if (o?.op === 'create_asset' && !named.has(o.kind ?? '')) {
      dropped.push(o.kind ?? 'a thing');
      continue;
    }
    kept.push(op);
  }
  return { ops: kept, dropped };
}

/**
 * A declared commitment is the ruling's too (intent-ops §5): one is recorded
 * only of the kind the arbiter's `establishes` named, and it carries the
 * mechanism that ruling chose, which the reducer then holds it to. A
 * commitment the arbiter never ruled is dropped.
 */
export function commitmentsAsRuled(
  ops: readonly unknown[],
  establishes: { kind: string; mechanism?: string } | undefined,
): { ops: unknown[]; dropped: string[] } {
  const kept: unknown[] = [];
  const dropped: string[] = [];
  for (const op of ops) {
    const o = op as { op?: string; kind?: string } | null;
    if (o?.op !== 'establish_commitment') {
      kept.push(op);
      continue;
    }
    if (!establishes || o.kind !== establishes.kind) {
      dropped.push(o.kind ?? 'an arrangement');
      continue;
    }
    kept.push({ ...o, mechanism: establishes.mechanism ?? 'record' });
  }
  return { ops: kept, dropped };
}

/**
 * A sway is sized by the roll, never by the model (intent-ops §3): an influence
 * check that worked moves the other power's view of the actor by
 * `SWAY_BY_BAND`, one sway a power per declaration. Any other stat, a failure,
 * or no check at all, and it moves nothing.
 */
export function swaysAsRolled(
  ops: readonly unknown[],
  stat: string | undefined,
  outcome: string | undefined,
): { ops: unknown[]; dropped: string[] } {
  const amount =
    stat === 'influence' && outcome !== undefined && outcome in SWAY_BY_BAND
      ? SWAY_BY_BAND[outcome as keyof typeof SWAY_BY_BAND]
      : undefined;
  const swayed = new Set<string>();
  const kept: unknown[] = [];
  const dropped: string[] = [];
  for (const op of ops) {
    const o = op as { op?: string; whom?: string } | null;
    if (o?.op !== 'sway') {
      kept.push(op);
      continue;
    }
    if (amount === undefined || swayed.has(o.whom ?? '')) {
      dropped.push(o.whom ?? 'a power');
      continue;
    }
    swayed.add(o.whom ?? '');
    kept.push({ ...o, amount });
  }
  return { ops: kept, dropped };
}

/**
 * The actor's own operative a piece of text names, by family name, or null.
 * Family names are unique per campaign, so a match is that operative.
 */
export function ownOperativeNamed(
  agents: readonly { name: string; ownerFactionId: string }[] | undefined,
  actor: string,
  text: string,
): string | null {
  const words = ` ${text.replace(/[^\p{L}\s'-]/gu, ' ').replace(/'s\b/g, '')} `;
  for (const a of agents ?? []) {
    if (a.ownerFactionId !== actor) continue;
    const family = familyOf(a.name);
    if (family && words.includes(` ${family} `)) return a.name;
  }
  return null;
}

/**
 * Whether a refusal's ground is true on the board: null when it holds, or what
 * is wrong with it. A model names the fact; code looks it up — the split
 * `classifyPrinciple` makes for breaches.
 */
export function checkGround(state: WorldState, actor: string, ground: RefusalGround): string | null {
  const lower = (x: string) => x.toLowerCase();
  switch (ground.kind) {
    case 'no_such_entity': {
      const name = ground.name.trim();
      const found = (() => {
        if (ground.entity === 'person') {
          const people = [
            ...(state.commanders ?? []),
            ...(state.agents ?? []),
            ...(state.listedAgents ?? []),
            ...(state.notables ?? []),
          ];
          return resolvePerson(people, name)?.name ?? null;
        }
        if (ground.entity === 'world') {
          return state.systems.find((x) => x.id === name || lower(x.name) === lower(name) || lower(x.name).includes(lower(name)))?.name ?? null;
        }
        if (ground.entity === 'power') {
          return state.factions.find((f) => f.id === name || lower(f.name).includes(lower(name)))?.name ?? null;
        }
        const words = lower(name).split(/[^a-z]+/).filter((w) => w.length > 3);
        return (
          (state.assets ?? []).find(
            (a) => a.id === name || (words.length > 0 && words.every((w) => lower(a.text).includes(w))),
          )?.text ?? null
        );
      })();
      return found ? `"${name}" does exist: ${found}.` : null;
    }
    case 'not_present': {
      const who = ground.factionId ?? actor;
      const world = state.systems.find((x) => x.id === ground.systemId);
      if (!world) return `There is no world "${ground.systemId}".`;
      const there =
        world.controllerFactionId === who ||
        hullsAt(world, who) > 0 ||
        (state.agents ?? []).some((a) => a.ownerFactionId === who && a.systemId === world.id && !a.exposed);
      return there ? `${who} is present at ${world.name}.` : null;
    }
    case 'not_held': {
      const words = lower(ground.name).split(/[^a-z]+/).filter((w) => w.length > 3);
      const held = (state.assets ?? []).find(
        (a) => a.heldBy === actor && (a.id === ground.name || (words.length > 0 && words.every((w) => lower(a.text).includes(w)))),
      );
      return held ? `${actor} holds ${held.text}.` : null;
    }
    case 'commitment_conflict': {
      const treaty = (state.treaties ?? []).find((t) => t.id === ground.id);
      if (treaty) {
        return treaty.status === 'active' && treaty.parties.includes(actor) ? null : `${ground.id} is not a live treaty binding ${actor}.`;
      }
      const commitment = (state.commitments ?? []).find((c) => c.id === ground.id);
      if (commitment) {
        return commitment.status === 'active' && commitment.factionIds.includes(actor)
          ? null
          : `${ground.id} is not a live commitment binding ${actor}.`;
      }
      return `There is no treaty or commitment "${ground.id}".`;
    }
    case 'already_so': {
      const id = ground.ref;
      const exists = [
        state.treaties,
        state.commitments,
        state.assets,
        state.agents,
        state.pendingOrders,
        state.debts,
        state.loans,
        state.obligations,
        state.demands,
        state.bounties,
        state.systems,
        state.factions,
      ].some((list) => ((list ?? []) as { id: string }[]).some((x) => x.id === id));
      return exists ? null : `There is no record "${id}" to make it so.`;
    }
  }
}
