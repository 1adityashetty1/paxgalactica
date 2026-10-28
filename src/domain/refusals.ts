import { familyOf, resolvePerson } from './command.js';
import { SWAY_BY_BAND } from './acts.js';
import type { Reach, RefusalGround } from './ops.js';
import { hullsAt, isMovementType, type WorldState } from './state.js';
import { fleetName, resolveFleet } from './fleets.js';
import { hullsIn } from './hulls.js';

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
): { ops: unknown[]; dropped: string[]; paying: string[] } {
  const kept: unknown[] = [];
  const dropped: string[] = [];
  /** The dropped ones that would have paid: the only ones worth telling the player about. */
  const paying: string[] = [];
  // A record binds nobody. Beside an act with a mechanism it was a duplicate —
  // a fortification, a fleet movement and a bounty each minted one, and every
  // later reader took them for promises (playtest 2026-10-19, S1) — and on its
  // own it is no better: a declaration cannot bind another
  // power, so it is only ever the actor's statement of policy, and every one
  // was later read back as a contract. "Hold Var Hollow" became
  // `torrek_watch_position`, and leaving Var Hollow was refused as repudiating
  // it; `development_talks` the same in loop 9, and `neth_accession_secured`
  // stood for a world that never joined in loop 10 (loops 9, 10, 15). Only a
  // ruled income — a charter on a world — is recorded from a declaration.
  // Founding a factory also minted a 12-a-turn income charter for it
  // (bughunt 2026-10-28): the work already delivers what it is for.
  const working = ops.some((op) => SELF_PAYING_WORK.has(String((op as { op?: string } | null)?.op)));
  for (const op of ops) {
    const o = op as { op?: string; kind?: string; incomePerTurn?: number } | null;
    if (o?.op !== 'establish_commitment') {
      kept.push(op);
      continue;
    }
    const drop = () => {
      dropped.push(o.kind ?? 'an arrangement');
      if ((o.incomePerTurn ?? 0) > 0) paying.push(o.kind ?? 'an arrangement');
    };
    if ((establishes?.mechanism ?? 'record') === 'record' || working) {
      drop();
      continue;
    }
    if (!establishes || o.kind !== establishes.kind) {
      drop();
      continue;
    }
    kept.push({ ...o, mechanism: establishes.mechanism ?? 'record' });
  }
  return { ops: kept, dropped, paying };
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

/** What a declaration's ruling allows a resolution batch to carry. */
export interface RulingBounds {
  covert: readonly { mission: string; systemId: string }[];
  groundwork: readonly { systemId: string }[];
  stat: string | undefined;
  outcome: string | undefined;
  establishes: { kind: string; mechanism?: string } | undefined;
  yields: readonly string[];
  /** Covert work with nothing rolled: the batch carries only the sending. */
  sentOnly: boolean;
  /** How the act was ruled able to reach another power (§4). Absent: not at all. */
  reaches?: readonly Reach[];
  /** Pending orders that are not the actor's, by id, for `their_orders`. */
  foreignOrders?: readonly string[];
  /** The player's own words, and the things the actor holds: a thing is spent only when named. */
  said?: string;
  held?: readonly { id: string; kind: string }[];
}

/**
 * A declaration spends only what the player put at stake. Founding a factory
 * consumed 120 units of salvage the player never mentioned, and a failed envoy
 * spent a crate of luxuries (bughunt 2026-10-27, 2026-10-28). A thing counts as
 * named by its id or by every word of its kind ("ration stores", "salvage").
 */
export function spendsAsSaid(
  ops: readonly unknown[],
  said: string,
  held: readonly { id: string; kind: string }[],
): { ops: unknown[]; dropped: string[] } {
  const words = ` ${said.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, ' ')} `;
  const named = (id: string): boolean => {
    if (words.includes(` ${id.toLowerCase()} `)) return true;
    const kind = held.find((a) => a.id === id)?.kind;
    if (!kind) return true; // not the actor's: the reducer's to refuse
    return kind.split('_').every((w) => new RegExp(`\\b${w}(?:s|es)?\\b`).test(words));
  };
  const kept: unknown[] = [];
  const dropped: string[] = [];
  for (const op of ops) {
    const o = op as { op?: string; assetId?: string } | null;
    if (o?.op === 'consume_asset' && o.assetId && !named(o.assetId)) {
      dropped.push((held.find((a) => a.id === o.assetId)?.kind ?? o.assetId).replace(/_/g, ' '));
      continue;
    }
    kept.push(op);
  }
  return { ops: kept, dropped };
}

/** Work whose payoff is its own: an income charter beside it is a second payment for one act. */
const SELF_PAYING_WORK = new Set(['found_fixture', 'develop', 'build_ships', 'fortify', 'raise_garrison', 'repair_fixture']);

/**
 * The reach an op makes into another power's business, or null for the
 * actor's own (`docs/design-2026-10-18-code-knows.md` §4). Drawn where the
 * damage is: a fortification dropped for want of a ruling is a worse failure
 * than a flourish, so a power's own building, moving, works, court and orders
 * pass unruled, and only these need naming.
 */
export function reachOf(op: unknown, foreignOrders: readonly string[]): Reach | null {
  const o = op as { op?: string; orderId?: string } | null;
  switch (o?.op) {
    case 'interrupt_order':
    case 'extend_order':
    case 'accelerate_order':
      return o.orderId && foreignOrders.includes(o.orderId) ? 'their_orders' : null;
    case 'suborn_crews':
      return 'their_ships';
    case 'break_treaty':
    case 'repudiate_obligation':
    case 'repudiate_loan':
    case 'call_obligation':
      return 'their_paper';
    case 'issue_ultimatum':
    case 'back_ultimatum':
    case 'publish_dossier':
    case 'blackmail':
      return 'coercion';
    default:
      return null;
  }
}

/**
 * Keep an op that reaches another power only when the ruling named its reach.
 * A critical success wrote `interrupt_order` on a rival's relief fleet as its
 * flourish and sent it home with no battle (playtest 2026-10-18, D3); four
 * filters each closed one op, and the vocabulary has sixty.
 */
export function opsAsRuled(
  ops: readonly unknown[],
  reaches: readonly Reach[],
  foreignOrders: readonly string[],
): { ops: unknown[]; dropped: string[] } {
  const kept: unknown[] = [];
  const dropped: string[] = [];
  for (const op of ops) {
    const reach = reachOf(op, foreignOrders);
    if (reach !== null && !reaches.includes(reach)) {
      dropped.push(String((op as { op?: unknown }).op));
      continue;
    }
    kept.push(op);
  }
  return { ops: kept, dropped };
}

/**
 * Hold a resolution batch to the ruling it was written under: sends, sways,
 * commitments and prizes as `sendsAsRuled`, `swaysAsRolled`,
 * `commitmentsAsRuled` and `prizesAsRuled` have them, and nothing but the
 * sending for covert work.
 *
 * One function, so the batch a correction call writes is held to the same
 * ruling as the first. And the filters' output is kept whether or not they
 * dropped anything: two of them STAMP what they keep — a sway with the band's
 * figure, a commitment with its ruled mechanism — and the caller kept their
 * output only when something was dropped, so a clean success swayed three
 * powers 9 each and nine declared commitments carried no mechanism at all
 * (playtest 2026-10-18, B1 and B5).
 */
export function holdToRuling(ops: readonly unknown[], bounds: RulingBounds): { ops: unknown[]; notes: string[] } {
  const notes: string[] = [];
  const sends = sendsAsRuled(ops, bounds.covert, bounds.groundwork);
  if (sends.dropped.length > 0) {
    notes.push(
      `An operative is sent only when the act is ruled covert: left out ${sends.dropped.join(', ')}. Declare it as their mission.`,
    );
  }
  const sways = swaysAsRolled(sends.ops, bounds.stat, bounds.outcome);
  if (sways.dropped.length > 0) {
    notes.push('A sway moves another power only on an influence check that worked, once a power: the rest came to nothing.');
  }
  const committed = commitmentsAsRuled(sways.ops, bounds.establishes);
  // A record binds nobody and is left out without a word: "left out
  // operative_recruitment" beside every recruitment was noise. An income
  // nobody ruled is money the player might have expected, so it is said.
  if (committed.paying.length > 0) {
    notes.push(
      `An income is recorded only when the arbiter ruled one: left out ${[...new Set(committed.paying)].map((k) => k.replace(/_/g, ' ')).join(', ')}.`,
    );
  }
  const spent = bounds.said !== undefined ? spendsAsSaid(committed.ops, bounds.said, bounds.held ?? []) : { ops: committed.ops, dropped: [] };
  if (spent.dropped.length > 0) {
    notes.push(`Only what you put at stake is spent: left out the ${[...new Set(spent.dropped)].join(', ')}, which you did not offer.`);
  }
  const prized = prizesAsRuled(spent.ops, bounds.yields);
  if (prized.dropped.length > 0) {
    notes.push(
      `A prize comes only of what the attempt was ruled able to yield: left out ${[...new Set(prized.dropped)].join(', ')}.`,
    );
  }
  const reached = opsAsRuled(prized.ops, bounds.reaches ?? [], bounds.foreignOrders ?? []);
  if (reached.dropped.length > 0) {
    notes.push(
      `An act reaches into another power's business only as it was ruled to: left out ${[...new Set(reached.dropped)].join(', ')}. Declare it as its own act.`,
    );
  }
  if (!bounds.sentOnly) return { ops: reached.ops, notes };
  const sent = covertSendOnly(reached.ops);
  if (sent.dropped.length > 0) {
    notes.push(
      `Covert work is sent, not rolled, so it carries only the sending: left out ${[...new Set(sent.dropped)].join(', ')}. Declare anything else on its own.`,
    );
  }
  return { ops: sent.ops, notes };
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
export function checkGround(state: WorldState, actor: string, ground: RefusalGround, action = ''): string | null {
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
        // A fleet is a thing on the board too, standing or under way.
        const fleets = [
          ...state.systems.flatMap((x) => x.fleets ?? []),
          ...state.pendingOrders.flatMap((o) => (o.fleet ? [{ ...o.fleet, factionId: o.factionId }] : [])),
        ];
        const fleet = resolveFleet(fleets, name);
        if (fleet) return fleetName(fleet.factionId, fleet);
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
      // A fleet existing does not make a move of it done.
      if (state.systems.some((x) => (x.fleets ?? []).some((f) => f.id === id))) {
        return `"${id}" is a fleet standing where it is; that it exists does not make the order already so.`;
      }
      // A voyage under way makes a move already so only if it is the actor's,
      // carries ships, and is the fleet the order names — an officer's passage
      // or another fleet's voyage is not this fleet's (bughunt 2026-10-26).
      const voyage = state.pendingOrders.find((o) => o.id === id && isMovementType(o.type));
      if (voyage) {
        if (voyage.factionId !== actor) return `"${id}" is another power's order, not this one.`;
        if (hullsIn(voyage.force) === (voyage.force.courier ?? 0)) return `"${id}" is an officer travelling alone; it carries no fleet, so no move of one is already under way.`;
        const mine = state.systems.flatMap((x) => (x.fleets ?? []).filter((f) => f.factionId === actor));
        const named = mine.find((f) => lower(action).includes(lower(fleetName(actor, f))));
        if (named && voyage.fleet?.id !== named.id) {
          return `"${id}" is ${voyage.fleet ? fleetName(actor, voyage.fleet) : 'another voyage'}, not ${fleetName(actor, named)}, which stands at ${state.systems.find((x) => (x.fleets ?? []).includes(named))?.name} with no order.`;
        }
      }
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

/**
 * A debt paid in goods is not paid by handing the goods over. Asked to "offer
 * the hull plate as partial settlement", resolution wrote both the handover
 * and a `settle_debt`, which pays cash: the plate went as a gift and the
 * debtor paid 50 besides (playtest 2026-10-19, loop 13). Taking goods in place
 * of money needs the creditor's word, so the cash payment beside a handover to
 * the same creditor is left out and the handover stands as what it is.
 */
export function noPaymentBesideAGift(
  ops: readonly unknown[],
  debts: readonly { id: string; creditorFactionId: string }[],
): { ops: unknown[]; dropped: boolean } {
  const givenTo = new Set(
    ops.flatMap((o) => {
      const t = o as { op?: string; toFactionId?: string };
      return t.op === 'transfer_asset' && t.toFactionId ? [t.toFactionId] : [];
    }),
  );
  if (givenTo.size === 0) return { ops: [...ops], dropped: false };
  const kept = ops.filter((o) => {
    const t = o as { op?: string; debtId?: string };
    if (t.op !== 'settle_debt') return true;
    const creditor = debts.find((d) => d.id === t.debtId)?.creditorFactionId;
    return !(creditor && givenTo.has(creditor));
  });
  return { ops: kept, dropped: kept.length !== ops.length };
}

/** The ops that organise a power's own fleets — free, and touching nobody. */
const ORGANISING = new Set(['rename_fleet', 'split_fleet', 'merge_fleets', 'assign_command', 'relieve_command']);

/**
 * Organising your own fleets costs nothing, whatever the roll. Declared in
 * words, a merge was rolled, came out a partial, and resolution billed 40
 * credits of "overtime" beside it (bughunt 2026-10-26) — while the same merge
 * from the Fleets tab is free. A declaration whose acts are all organising has
 * any payment beside it left out.
 */
/**
 * Whether a declaration did nothing but organise the power's own fleets. The
 * same change from the Fleets tab spends no action, so neither does this one
 * (bughunt 2026-10-27: a merge said in words was rolled and charged an action).
 */
export function onlyOrganising(ops: readonly unknown[]): boolean {
  const acts = ops.map((o) => (o as { op?: string }).op ?? '').filter((k) => k !== 'log_narrative');
  return acts.length > 0 && acts.every((k) => ORGANISING.has(k));
}

export function organisingIsFree(ops: readonly unknown[]): { ops: unknown[]; dropped: boolean } {
  const kinds = ops.map((o) => (o as { op?: string }).op ?? '');
  const acts = kinds.filter((k) => k !== 'log_narrative');
  if (acts.length === 0 || !acts.some((k) => ORGANISING.has(k))) return { ops: [...ops], dropped: false };
  if (!acts.every((k) => ORGANISING.has(k) || k === 'spend' || k === 'pay')) return { ops: [...ops], dropped: false };
  const kept = ops.filter((o) => !['spend', 'pay'].includes((o as { op?: string }).op ?? ''));
  return { ops: kept, dropped: kept.length !== ops.length };
}
