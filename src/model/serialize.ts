import { eventsVisibleTo, ordersVisibleTo } from '../domain/intel.js';
import { describeStack, hullsIn } from '../domain/hulls.js';
import { describeOrderEffect } from '../domain/development.js';
import { agentStanding, assetWorthRangeTo, describeEffect, wantedBy } from '../domain/diplomacy.js';
import { describeOutstanding } from '../domain/loan.js';
import { routeEarnings } from '../domain/trade.js';
import {
  MAX_ACTIVE_COMMANDERS,
  activeCommanders,
  archetypeOf,
  commanderEffect,
  commanderFor,
  commanderPassive,
  toNextVeterancy,
  veterancyLabel,
} from '../domain/command.js';
import type { Commitment } from '../domain/arbitration.js';
import {
  formatModifier,
  statModifier,
  STAT_NAMES,
  type FactionStats,
} from '../domain/checks.js';
import {
  presentAt,
  dissentPenalty,
  terrainBonus,
  WORLD_TYPES,
  WORLD_TYPE_STAT,
  dispositionBetween,
  getFaction,
  getSystem,
  isMovementType,
  agentsVisibleTo,
  fleetStrengthOf,
  fleetTonsOf,
  ledgerFor,
  liveAgentsOf,
  maxAgentsFor,
  systemIncome,
  treatiesFor,
  warsFor,
  TRADE_ETHIC_MEANING,
  WAR_ETHIC_MEANING,
  type Faction,
  type WorldState,
} from '../domain/state.js';

/**
 * State is serialized as compact Markdown rather than raw JSON. The models
 * read it far more reliably, and it keeps the token cost of a 25-system
 * galaxy manageable across four calls a turn.
 */

function fmtDisposition(n: number): string {
  if (n >= 60) return `${n} (allied)`;
  if (n >= 20) return `${n} (friendly)`;
  if (n > -20) return `${n} (neutral)`;
  if (n > -60) return `${n} (hostile)`;
  return `${n} (at daggers drawn)`;
}

export function serializeStats(stats: FactionStats): string {
  return STAT_NAMES.map(
    (s) => `${s} ${stats[s]} (${formatModifier(statModifier(stats[s]))})`,
  ).join(' · ');
}

/**
 * How much of a power to render.
 *
 * `positions` is where every power stands — fleet, treasury, territory,
 * stats, tolls, disposition. `full` adds who it IS: its war and trade ethics
 * spelled out, and its doctrine paragraph.
 *
 * The split exists for the arbiter. It rules on whether the ACTING power may
 * attempt a thing, what that tests and how hard — and it is handed that
 * power's own red lines and compulsions separately, by `serializePrinciples`.
 * Four other powers' doctrine paragraphs decide none of those questions, and
 * they were 1.6k characters of every appraisal call, which is the most
 * frequent call in the game.
 */
export type FactionDetail = 'positions' | 'full';

export function serializeFactions(
  state: WorldState,
  viewerId: string,
  /** Non-viewer rows. The viewer's own row is always rendered in full. */
  detail: FactionDetail = 'full',
): string {
  const lines = state.factions.map((f) => {
    const held = state.systems.filter((s) => s.controllerFactionId === f.id).length;
    const isViewer = f.id === viewerId;
    const self = isViewer ? ' — THIS IS YOU' : '';
    const toward =
      f.id === viewerId
        ? ''
        : ` | disposition toward ${viewerId}: ${fmtDisposition(dispositionBetween(state, f.id, viewerId))}`;
    return [
      `- **${f.name}** (id: \`${f.id}\`)${self}`,
      `  fleet ${fleetStrengthOf(state, f.id)} hulls / ${fleetTonsOf(state, f.id)} tons | credits ${f.credits} | ${held} systems${toward}`,
      `  stats: ${serializeStats(f.stats)}`,
      // The ethics keep their labels even when trimmed: `expansionist` and
      // `monopolist` are what a power IS, and the arbiter does price an action
      // against them. What goes is the sentence explaining each one, which the
      // model does not need spelled out five times a call.
      isViewer || detail === 'full'
        ? `  war: ${f.warEthic} — ${WAR_ETHIC_MEANING[f.warEthic]}`
        : `  war: ${f.warEthic}`,
      isViewer || detail === 'full'
        ? `  trade: ${f.tradeEthic} — ${TRADE_ETHIC_MEANING[f.tradeEthic]}`
        : `  trade: ${f.tradeEthic}`,
      // Public by design: a tariff is announced, not discovered. It is also the
      // single most negotiable thing on this sheet, so a power that cannot read
      // who charges it cannot come and argue about it.
      `  tolls: ${
        f.tollTargets.length === 0
          ? 'charges nobody for passage'
          : `charges ${f.tollTargets.map((id) => getFaction(state, id)?.name ?? id).join(', ')} for passage`
      }`,
      isViewer || detail === 'full' ? `  doctrine: ${f.doctrine}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  });
  return lines.join('\n');
}

/**
 * The full character sheet for one power, used wherever a faction has to ACT
 * or SPEAK as itself rather than merely be observed.
 */
/**
 * Who takes this power's next battle.
 *
 * A named officer is the cheapest thing that turns an engagement between two
 * rivals from arithmetic into a story, and a persona that cannot name its own
 * fleet commander cannot tell that story.
 */
function commanderLine(state: WorldState, viewerId: string): string {
  const officer = commanderFor(state.commanders, viewerId);
  if (!officer) {
    const held = (state.commanders ?? []).filter(
      (c) => c.factionId === viewerId && c.status === 'captured',
    );
    // A power with nobody in post is a power that can appoint one, and saying
    // so is the difference between a gap and a mystery.
    return held.length > 0
      ? `You have no officer in post. ${held.map((c) => c.name).join(' and ')} ${held.length === 1 ? 'is' : 'are'} in enemy hands.`
      : 'You have no officer in post.';
  }
  const shape = archetypeOf(officer.archetype);
  const seen =
    officer.battles > 0
      ? `, ${veterancyLabel(officer.battles)} at ${officer.battles} engagement${officer.battles === 1 ? '' : 's'}`
      : ', untested';
  // What losing their would cost, said plainly. A power that cannot tell a
  // veteran from a replacement has no reason to fight shy of spending them, and
  // the successor arrives with the same speciality and none of the record.
  // The rest of the roster, and the room left in it. A power that cannot see it
  // has five officers' worth of decision it does not know it has.
  const others = activeCommanders(state.commanders, viewerId).filter((c) => c.id !== officer.id);
  const room = MAX_ACTIVE_COMMANDERS - (others.length + 1);
  const roster =
    (others.length > 0
      ? ` Also in post: ${others.map((c) => `${c.name} (${commanderEffect(c)})`).join('; ')}.`
      : '') +
    (room > 0 ? ` You may appoint ${room} more.` : ' Your roster is full.');
  const owed = toNextVeterancy(officer.battles);
  const ladder =
    owed === null
      ? ' They are as good as an officer gets; a successor would start again from nothing.'
      : ` ${owed} more engagement${owed === 1 ? '' : 's'} and they improve again. A successor inherits the speciality and none of the record.`;
  // Where they are, because it now decides which battles they are in at all — a
  // power told it has a commander and not told they are three jumps from the
  // fighting has been told something misleading.
  const posted = officer.atSystemId
    ? ` They are at ${getSystem(state, officer.atSystemId)?.name ?? officer.atSystemId}`
    : (() => {
        const o = (state.pendingOrders ?? []).find((x) => x.commanderId === officer.id);
        return o
          ? ` They are under way to ${getSystem(state, o.targetId)?.name ?? o.targetId}`
          : ' They are unposted';
      })();
  return `Your fleet is commanded by ${officer.name}${seen} — known for ${shape.known}. In a battle, ${commanderEffect(officer)}; the rest of the time, ${commanderPassive(officer)}.${posted}, and command only the battle they are at.${ladder}${roster}`;
}

/** Worlds a power holds that began as somebody else's, by name. */
function occupiedNames(state: WorldState, viewerId: string): string {
  const names = state.systems
    .filter(
      (sys) =>
        sys.controllerFactionId === viewerId &&
        sys.homeFactionId !== null &&
        sys.homeFactionId !== viewerId,
    )
    .map((sys) => sys.name);
  return names.length > 0 ? names.join(', ') : 'worlds taken from others';
}

/**
 * What the ground itself is worth to this power, if anything.
 *
 * Stated as the worlds rather than as a number, because the actionable half is
 * *which kind of world to take next* — a bonus a player cannot trace to a place
 * on the map is a number that happens to them.
 */
function terrainLine(state: WorldState, viewerId: string): string {
  const bonus = terrainBonus(state, viewerId);
  const gained = STAT_NAMES.filter((stat) => (bonus[stat] ?? 0) > 0);
  if (gained.length === 0) return '';
  const parts = gained.map((stat) => {
    const kinds = WORLD_TYPES.filter((t) => WORLD_TYPE_STAT[t] === stat);
    const held = state.systems.filter(
      (sys) => sys.controllerFactionId === viewerId && kinds.includes(sys.worldType),
    ).length;
    return `${stat} +${bonus[stat]} (${held} ${kinds.join('/')} worlds)`;
  });
  return `What your ground is worth: ${parts.join(' · ')}. Taking more of one kind is worth more than taking more.`;
}

/**
 * A faction's stats after its own dissent, which is all `serializeCharacter`
 * can account for — it has no world state, so hostile stat_debuffs are not
 * visible here. Still better than quoting the base: the persona should not
 * describe itself as more capable than the reducer will let it be.
 */
function effectiveFor(faction: Faction): FactionStats {
  const penalty = dissentPenalty(faction.dissent);
  if (penalty === 0) return faction.stats;
  return Object.fromEntries(
    STAT_NAMES.map((s) => [s, Math.max(1, faction.stats[s] - penalty)]),
  ) as FactionStats;
}

export function serializeCharacter(faction: Faction): string {
  return [
    `**${faction.name}** (\`${faction.id}\`)`,
    '',
    `Doctrine: ${faction.doctrine}`,
    '',
    `How you speak: ${faction.voice}`,
    '',
    `On war — ${faction.warEthic}: ${WAR_ETHIC_MEANING[faction.warEthic]}`,
    `On trade — ${faction.tradeEthic}: ${TRADE_ETHIC_MEANING[faction.tradeEthic]}`,
    // Without this the model could neither see nor narrate the fact that its
    // own institutions had lost faith in it, while every stat it was being
    // asked to reason about was already reduced by exactly that.
    faction.dissent > 0
      ? `Internal dissent: ${faction.dissent}/100 — every stat is reduced by ${dissentPenalty(faction.dissent)}. Your institutions have been overruled once too often.`
      : 'Internal dissent: none. Your institutions are behind you.',
    '',
    `Capabilities: ${serializeStats(effectiveFor(faction))}`,
    faction.redLines.length > 0
      ? `\nYou will NOT, whatever the incentive:\n${faction.redLines.map((r) => `  - ${r}`).join('\n')}`
      : '',
    faction.compulsions.length > 0
      ? `\nYour own institutions DEMAND of you:\n${faction.compulsions.map((c) => `  - ${c.text}`).join('\n')}`
      : '',
    faction.buildBias.length > 0
      ? `\nWhen you build, you reach first for: ${faction.buildBias.map((b) => b.replace(/_/g, ' ')).join(', ')}.`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * What a power will not do, and what it insists on — and nothing else.
 *
 * The arbiter rules on whether an action breaks one of these lines, so it has
 * to be shown them; it emphatically does not need `voice`, which is a page of
 * dialect notes for writing dialogue and, for Arkane, several thousand tokens
 * of it. Handing the whole character sheet to a bounded classification call
 * would have quietly doubled the price of every action in the game.
 */
export function serializePrinciples(faction: Faction): string {
  return [
    `**${faction.name}** (\`${faction.id}\`)`,
    '',
    `Doctrine: ${faction.doctrine}`,
    `On war — ${faction.warEthic}. On trade — ${faction.tradeEthic}.`,
    faction.redLines.length > 0
      ? `\nYou will NOT, whatever the incentive:\n${faction.redLines.map((r) => `  - ${r}`).join('\n')}`
      : '\n_This power holds no red lines._',
    faction.compulsions.length > 0
      ? `\nYour own institutions DEMAND of you:\n${faction.compulsions.map((c) => `  - ${c.text}`).join('\n')}`
      : '\n_This power is under no compulsions._',
  ].join('\n');
}

/** Treaties, wars and visible agents — the standing situation, per faction. */
export function serializeStanding(state: WorldState, viewerId: string): string {
  const treaties = treatiesFor(state, viewerId);
  const wars = warsFor(state, viewerId);
  const agents = agentsVisibleTo(state, viewerId);

  const lines: string[] = [];

  lines.push('**Treaties in force**');
  if (treaties.length === 0) lines.push('  _None._');
  for (const t of treaties) {
    const other = t.parties.find((p) => p !== viewerId) ?? '?';
    const until = t.expiresTurn === null ? 'indefinite' : `until turn ${t.expiresTurn}`;
    // Exclusivity has to be ON the line the arbiter reads, not merely in the
    // record: `appraisal.md` rules a second exclusive arrangement inadmissible
    // from this block, and it cannot rule on a field it was never shown. The
    // commitments block has carried the same flag since exclusivity existed
    // there.
    const only = t.exclusive ? ' **[exclusive — one at a time]**' : '';
    lines.push(`  - \`${t.id}\` ${t.type.replace(/_/g, ' ')} with ${other} (${until})${only} — ${t.summary}`);
    const flow = t.terms.incomePerTurn[viewerId];
    if (flow) lines.push(`      income: ${flow > 0 ? '+' : ''}${flow}/turn`);
    for (const share of t.terms.incomeShares) {
      lines.push(`      ${Math.round(share.share * 100)}% of ${share.systemId} to ${share.factionId}`);
    }
    if (t.terms.mutualDefenseTrigger) lines.push(`      triggers on: ${t.terms.mutualDefenseTrigger}`);
  }

  lines.push('', '**At war with**');
  lines.push(wars.length === 0 ? '  _Nobody, formally._' : `  ${wars.join(', ')}`);

  // The ceiling, not just the list. `maxAgentsFor` had no reader anywhere in
  // `src/model/`, so no call knew a faction was at its limit — and a resolution
  // pass that cannot see the cap narrates a placement it cannot legally make.
  // Found in a 27-turn playtest: at 3 of 3, "buy a clerk in the customs house"
  // produced a full success story and **zero ops**, with no rejection and no
  // note, because the model simply never emitted the op that would have been
  // refused. Same shape as the arbiter never being shown the red lines it was
  // asked to enforce: a rule the model cannot see is a rule it narrates around.
  const live = liveAgentsOf(state, viewerId).length;
  const ceiling = maxAgentsFor(state, viewerId);
  lines.push(
    '',
    `**Your operatives: ${live} of ${ceiling}**` +
      (live >= ceiling
        ? ' — AT YOUR LIMIT. You cannot place another until one is recalled or burned.'
        : ` (room for ${ceiling - live} more)`),
  );

  lines.push('', '**Agents you know of**');
  if (agents.length === 0) lines.push('  _None._');
  for (const a of agents) {
    const mine = a.ownerFactionId === viewerId;
    const where = getSystem(state, a.systemId)?.name ?? a.systemId;
    lines.push(
      // The operative's NAME, and their power's display name rather than its
      // id — the same leak item 104 closed two lines further up this file, left
      // behind here because nothing reads this block back except the model.
      `  - \`${a.id}\` ${a.name || a.cover || 'an operative'}, ${mine ? 'YOURS' : `${nameOfFaction(state, a.ownerFactionId)} (exposed)`} on ${where}: ${a.mission}, ${describeEffect(a.effect)}, ${a.successChance}% per turn — ${agentStanding(a.operations)}${a.timesCaught > 0 ? `, caught ${a.timesCaught} time${a.timesCaught === 1 ? '' : 's'}` : ''}${a.exposed ? ' — BURNED' : ''}`,
    );
  }

  return lines.join('\n');
}

/** A faction's display name, never its id. See `serializeSystems`. */
function nameOfFaction(state: WorldState, id: string): string {
  return getFaction(state, id)?.name ?? id;
}

export function serializeSystems(state: WorldState): string {
  const bySector = new Map<string, string[]>();
  for (const s of state.systems) {
    const controller = s.controllerFactionId
      ? getFaction(state, s.controllerFactionId)?.name ?? s.controllerFactionId
      : 'unaligned';
    const income = systemIncome(state, s);
    // Composed, not counted. The resolution prompt says a world is taken by
    // the lift arm; a state block that reports "freeworlds 12" cannot tell the
    // model whether any of the twelve can put troops on the ground, so the
    // rule would be unactionable exactly where it matters.
    const ships = Object.entries(s.ships ?? {})
      .filter(([, stack]) => hullsIn(stack) > 0)
      .map(([id, stack]) => `${nameOfFaction(state, id)} ${describeStack(stack)}`)
      .join(', ');
    const payout = Object.entries(income.shares)
      .filter(([, v]) => v > 0)
      .map(([id, v]) => `${nameOfFaction(state, id)} ${v}`)
      .join(', ');
    // **Lanes carry the name as well as the id, and that is a bug fix.** This
    // joined `hyperlaneEdges` raw, so the state document told every persona
    // that Vergesse connects to "ilv-6, ilv-7" and nothing anywhere gave those
    // strings a name — so the model wrote the ids into prose and the player
    // read `ilv-6/ilv-7` in a narrative. Exactly the lesson the faction rename
    // records: **ids are not private**, and a document that publishes one
    // without its name has published the id.
    //
    // Both, not the name alone: the id is what a `fleet_movement` has to
    // address, and making the model resolve a name back to an id through
    // another block is a step it can get wrong.
    const lanes = s.hyperlaneEdges
      .map((id) => `${getSystem(state, id)?.name ?? id} (\`${id}\`)`)
      .join(', ');
    const line = [
      `  - \`${s.id}\` ${s.name} — held by ${controller}, garrison ${s.garrison}, value ${s.strategicValue}${income.contested ? ', CONTESTED' : ''}`,
      `      ships: ${ships || 'none'} | pays: ${payout || 'nobody'} | lanes: ${lanes || 'none'}`,
    ].join('\n');
    const list = bySector.get(s.sector) ?? [];
    list.push(line);
    bySector.set(s.sector, list);
  }
  return [...bySector.entries()]
    .map(([sector, lines]) => `- **${sector}**\n${lines.join('\n')}`)
    .join('\n');
}

/**
 * Orders as seen by one faction. NPC reaction prompts get this scoped view so
 * a faction can react to an enemy project only if it can actually observe it —
 * which is what makes long builds worth hiding, and worth raiding.
 */
export function serializeOrders(state: WorldState, viewerId: string): string {
  const visible = ordersVisibleTo(state, viewerId);
  if (visible.length === 0) return '_No orders you can observe are under way._';
  return visible
    .map((o) => {
      const owner = getFaction(state, o.factionId)?.name ?? o.factionId;
      const target = getSystem(state, o.targetId)?.name ?? o.targetId;
      const remaining = o.durationTurns - o.progress;
      const mine = o.factionId === viewerId ? 'YOURS' : 'observed';
      const kind = isMovementType(o.type) ? 'fleet movement' : o.type.replace(/_/g, ' ');
      const raidable = o.interruptible ? 'interruptible' : 'cannot be interrupted';
      // What it will deliver, so a project already paid for is not re-ordered
      // and so a rival can see what is worth interrupting.
      const delivers = o.onComplete
        ? `, delivers ${describeOrderEffect(o.onComplete)} on completion`
        : '';
      return `- \`${o.id}\` [${mine}] ${owner}: ${o.label} (${kind}) -> ${target}, ${remaining} of ${o.durationTurns} turns remaining${delivers}, ${raidable}, on interrupt: ${o.onInterrupt}`;
    })
    .join('\n');
}

export function serializeRecentLog(state: WorldState, viewerId: string, limit = 12): string {
  // Symmetric with the player's view: an NPC reasons from the log too, and a
  // rival's covert placement is no more its business than it is the player's.
  const recent = eventsVisibleTo(state, viewerId).slice(-limit);
  if (recent.length === 0) return '_Nothing has happened yet._';
  return recent.map((e) => `- [turn ${e.turn}] ${e.text}`).join('\n');
}

/** The full state block handed to a model call, from one faction's viewpoint. */
export function serializeState(
  state: WorldState,
  viewerId: string,
  /**
   * How much of the OTHER powers to render. `full` everywhere except the
   * arbiter — see `FactionDetail`.
   */
  detail: FactionDetail = 'full',
): string {
  const viewer = getFaction(state, viewerId);
  const ledger = ledgerFor(state, viewerId);
  return [
    `# Galaxy state — turn ${state.turn}`,
    '',
    `Viewpoint: **${viewer?.name ?? viewerId}** (\`${viewerId}\`)`,
    `Treasury: ${viewer?.credits ?? 0} credits · income ${ledger.gross}/turn (${ledger.territory} territory + ${ledger.routes} trade lanes), upkeep ${ledger.upkeep}/turn (net ${ledger.net >= 0 ? '+' : ''}${ledger.net})`,
    ledger.tolls > 0 ? `Tolls levied on other powers' cargo: ${ledger.tolls}/turn.` : '',
    ledger.raided > 0 ? `Taken by commerce raiding: ${ledger.raided}/turn.` : '',
    // A standing cost with no visible cause is a number the leader cannot act
    // on. Naming the worlds is the point: this is the line that tells a player
    // which conquest is not paying for itself.
    ledger.occupation > 0
      ? `Holding ground that was never yours: ${ledger.occupation}/turn, on ${occupiedNames(state, viewerId)}. Institutions built for another state do not administer themselves.`
      : '',
    terrainLine(state, viewerId),
    commanderLine(state, viewerId),
    // Dissent reduces every stat the model is reasoning about. Omitting it
    // meant a leader could be told its own odds had worsened with no way to
    // know why, and could not narrate the reason to the player either.
    viewer && viewer.dissent > 0
      ? `Internal dissent: ${viewer.dissent}/100 — your institutions have been overruled once too often, and every capability below is already reduced by ${dissentPenalty(viewer.dissent)}. It falls 2 a turn if you stop.`
      : '',
    '',
    '## Factions',
    serializeFactions(state, viewerId, detail),
    '',
    '## Systems by sector',
    serializeSystems(state),
    '',
    '## Orders in progress (as you can observe them)',
    serializeOrders(state, viewerId),
    '',
    '## Standing position',
    serializeStanding(state, viewerId),
    '',
    '## Standing commitments',
    serializeCommitments(state, viewerId),
    '',
    '## What you hold',
    serializeAssets(state, viewerId),
    '',
    '## Debts',
    serializeDebts(state),
    '',
    '## Lent and borrowed',
    serializeLoans(state, viewerId),
    '',
    '## Recent events',
    serializeRecentLog(state, viewerId),
  ].join('\n');
}

/**
 * Which factions should get a reaction call: those whose interests the turn
 * actually touched. Ranked by involvement, then by how strongly they already
 * feel about the player, so a quiet turn still surfaces the factions with a
 * stake in the player's position.
 */
export function mostAffectedFactions(
  state: WorldState,
  touchedFactionIds: string[],
  touchedSystemIds: string[],
  excludeId: string,
  limit = 4,
): string[] {
  const touched = new Set(touchedFactionIds);
  const neighbours = new Set<string>();
  for (const sid of touchedSystemIds) {
    const sys = getSystem(state, sid);
    if (!sys) continue;
    if (sys.controllerFactionId) neighbours.add(sys.controllerFactionId);
    for (const edge of sys.hyperlaneEdges) {
      const adj = getSystem(state, edge);
      if (adj?.controllerFactionId) neighbours.add(adj.controllerFactionId);
    }
  }

  const scored = state.factions
    .filter((f) => f.id !== excludeId)
    .map((f) => {
      let score = 0;
      if (touched.has(f.id)) score += 100;
      if (neighbours.has(f.id)) score += 50;
      // Strong feelings in either direction mean a stake in what just happened.
      score += Math.abs(dispositionBetween(state, f.id, excludeId)) / 10;
      return { id: f.id, score };
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  return scored.slice(0, limit).map((s) => s.id);
}

/**
 * Arrangements the op vocabulary has no home for, listed so the arbiter can
 * see what is already true. Without this block it would allow a dynastic
 * marriage on turn 3 and, having no memory, a second one on turn 4.
 */
/**
 * What a proportional share is paying right now.
 *
 * A share was a negotiable instrument whose value nobody at the table could
 * see: a playtest sold the Combine 50% of a *smuggler's* tolls — a flow that
 * was structurally zero at the time — and neither the counterparty's persona
 * nor the arbiter could tell the consideration was nothing. Quoting the live
 * figure beside the rate is what lets either of them notice.
 *
 * "Currently" is doing real work in that sentence: this moves every turn, which
 * is the whole point of a share, so it is a fact about today and not a promise.
 */
function shareWorth(state: WorldState, share: NonNullable<Commitment['share']>): number {
  const earnings = routeEarnings(state);
  const pot =
    share.of === 'routes'
      ? (earnings.shares[share.from] ?? 0)
      : share.of === 'tolls'
        ? (earnings.tolls[share.from] ?? 0)
        : (earnings.raided[share.from] ?? 0);
  return pot <= 0 ? 0 : Math.floor((pot * share.percent) / 100);
}

/**
 * What is being held, and what it is worth to whom.
 *
 * Scoped to the viewer's own holdings: what a power is sitting on is exactly
 * the sort of thing a rival should have to find out. The one exception is that
 * `valuePerUnit` names everybody it is worth something to — because that
 * asymmetry is the whole reason to trade, and a persona that cannot see the
 * other side wants a thing cannot price it. A playtest sold the same
 * intelligence twice and bargained a figure that settled 35 lower, both because
 * nobody at the table could see what was on it.
 */
/**
 * What the power across the table is holding that the viewer wants.
 *
 * Without this a persona could put a price on nothing: it saw its own shelf and
 * had no way to know that the Combine was sitting on forty of its crews, so the
 * only things it could ever offer for were worlds, hulls and money. A
 * negotiation over objects needs both inventories on the table, and the fog
 * argument does not apply — you know perfectly well who took your people.
 *
 * Scoped by **value to the viewer**, which is a sharper filter than it looks: an
 * asset with no entry for you is one you have shown no interest in, and listing
 * a rival's whole warehouse would be an intelligence leak dressed up as a
 * shopping list.
 */
export function serializeTheirAssets(
  state: WorldState,
  viewerId: string,
  holderId: string,
): string {
  const theirs = (state.assets ?? []).filter(
    (a) => a.heldBy === holderId && assetWorthRangeTo(a, viewerId).max > 0,
  );
  if (theirs.length === 0) return '_Nothing of theirs that you have shown any interest in._';
  return theirs
    .map((a) => {
      const band = assetWorthRangeTo(a, viewerId);
      const worth =
        band.min === band.max
          ? `worth about ${band.max} to you`
          : `worth somewhere between ${band.min} and ${band.max} to you — nobody has settled it`;
      return `- \`${a.id}\` ${a.quantity} ${a.unit} — ${a.text}\n  ${worth}`;
    })
    .join('\n');
}

export function serializeAssets(state: WorldState, viewerId: string): string {
  const mine = (state.assets ?? []).filter((a) => a.heldBy === viewerId);
  if (mine.length === 0) return '_You hold nothing beyond credits, ships and ground._';
  return mine
    .map((a) => {
      const wanted = wantedBy(a, viewerId)
        .map((id) => {
          const band = assetWorthRangeTo(a, id);
          const per = a.quantity > 0 ? a.quantity : 1;
          return band.min === band.max
            ? `${getFaction(state, id)?.name ?? id} would pay about ${Math.floor(band.max / per)} a ${a.unit}`
            : `${getFaction(state, id)?.name ?? id} might pay ${Math.floor(band.min / per)}–${Math.floor(band.max / per)} a ${a.unit}, unsettled`;
        })
        .join('; ');
      const where = a.atSystemId ? ` · at ${getSystem(state, a.atSystemId)?.name ?? a.atSystemId}` : '';
      const split = a.divisible ? '' : ' · one thing, does not divide';
      // A fixture is the one thing on this list you cannot put on the table, so
      // it is said here rather than discovered by having the accord rejected.
      const fixed = a.portable ? '' : ' · fixed here; changes hands only with the world';
      const plays =
        a.uses === null
          ? ''
          : a.uses === 1
            ? ' · played ONCE, then it is spent'
            : ` · ${a.uses} plays left`;
      const does =
        a.yield === null
          ? ''
          : a.yield.kind === 'credits'
            ? ` · pays ${a.yield.perTurn} a turn`
            : a.yield.kind === 'dissent'
              ? ` · moves your dissent ${a.yield.perTurn > 0 ? '+' : '−'}${Math.abs(a.yield.perTurn)} a turn`
              : ` · yields ${a.yield.perTurn} ${a.yield.unit} a turn`;
      return `- \`${a.id}\` ${a.quantity} ${a.unit} — ${a.text}${where}${split}${fixed}${plays}${does}\n  ${
        wanted || 'nobody has shown it is worth anything to them'
      }`;
    })
    .join('\n');
}

export function serializeCommitments(state: WorldState, viewerId?: string): string {
  // SCOPED TO THE PARTIES, like `treatiesFor` already scopes the treaty list
  // two blocks below it. This rendered every live commitment into all five
  // prompts, so a private two-party arrangement was published to the whole
  // galaxy — measured: the Iron Vigil quoted the exact 7% share of a commitment
  // binding only the Combine and Drajk.
  //
  // The LOG half of this leak was closed earlier the same day and written up as
  // fixed, which is the part worth remembering: `logEvent` was scoped and the
  // state block one function away was not, so the fix looked complete and the
  // prompt still carried the secret. A leak is a property of the whole payload.
  //
  // `viewerId` is optional so a caller without one gets the old behaviour
  // rather than an empty block; every caller in the engine passes it.
  const live = (state.commitments ?? []).filter(
    (c) =>
      c.status === 'active' && (viewerId === undefined || c.factionIds.includes(viewerId)),
  );
  if (live.length === 0)
    return viewerId === undefined
      ? '_None. Nothing beyond treaties currently binds anyone._'
      : '_None. Nothing beyond treaties binds you._';

  return live
    .map((c) => {
      const who = c.factionIds
        .map((id) => getFaction(state, id)?.name ?? id)
        .join(' & ');
      const flag = c.exclusive ? ' **[exclusive — one at a time]**' : '';
      const worth =
        c.incomePerTurn !== 0
          ? ` · ${c.incomePerTurn > 0 ? '+' : ''}${c.incomePerTurn} credits/turn`
          : '';
      // A proportional term is worth reading out in full: it is the one part
      // of a commitment whose value changes every turn, so a flat figure would
      // tell the reader nothing about what it is currently paying.
      const cut =
        c.share === undefined
          ? ''
          : ` · ${c.share.percent}% of ${getFaction(state, c.share.from)?.name ?? c.share.from}'s ${c.share.of} to ${getFaction(state, c.share.to)?.name ?? c.share.to} (currently worth ${shareWorth(state, c.share)} a turn)`;
      return `- \`${c.id}\` ${c.kind.replace(/_/g, ' ')} · ${who} · since turn ${c.establishedTurn}${worth}${cut}${flag}\n  _as agreed, in their words: ${c.text}_`;
    })
    .join('\n');
}

/**
 * Money owed between powers, and who is behind on it.
 *
 * Shown to every call rather than only the creditor's, because a debt is a
 * lever anyone can reason about: a defaulting debtor is a power with a
 * grievance pointed at it, and that is exactly the opening a third party looks
 * for. It is also the state the arbiter needs in order to rule on the Combine's
 * two debt lines against something real rather than a fiction.
 */
/**
 * What is out on loan, to the parties only.
 *
 * Scoped like `serializeCommitments` rather than left open like
 * `serializeDebts`, and the difference is worth stating: a debt is paper that
 * circulates — it can be assigned, and a third power buying it is an ordinary
 * move — while the terms of a hire are between the two who struck them. The
 * *hulls* are visible to anyone with eyes on the system, because
 * `system.ships` is never redacted; what they cost and when they go home is
 * not.
 */
export function serializeLoans(state: WorldState, viewerId: string): string {
  const live = (state.loans ?? []).filter(
    (l) =>
      (l.status === 'current' || l.status === 'delinquent') &&
      (l.lenderFactionId === viewerId || l.borrowerFactionId === viewerId),
  );
  if (live.length === 0) return '_You have nothing out on loan, and hold nothing of anybody else’s._';
  return live
    .map((l) => {
      const lender = getFaction(state, l.lenderFactionId)?.name ?? l.lenderFactionId;
      const borrower = getFaction(state, l.borrowerFactionId)?.name ?? l.borrowerFactionId;
      const what = describeOutstanding(l);
      const rent = l.rentPerTurn > 0 ? `, ${l.rentPerTurn}/turn` : ', for nothing';
      const due =
        l.status === 'defaulted'
          ? ', NOT RETURNED — it is being kept'
          : l.dueTurn === null
            ? ', no term set'
            : `, back by turn ${l.dueTurn}`;
      const behind =
        l.missedPayments > 0 ? ` — ${l.missedPayments} hire payment(s) missed` : '';
      // The figures first, then the prose on its own line and clearly labelled
      // as prose. They used to run together in one sentence, so a loan trimmed
      // at signature read "4 battleships … Ten Combine hulls sail under
      // Meridian colours" with nothing to say which was the term and which was
      // the description. `diplomacy-persona.md` already rules that the state
      // block beats a transcript; this is that rule one level down, inside the
      // block, where it could not previously reach.
      return `  - \`${l.id}\` ${lender} has ${what} with ${borrower}${rent}${due}${behind}.\n    _as agreed, in their words: ${l.text}_`;
    })
    .join('\n');
}

export function serializeDebts(state: WorldState): string {
  const live = (state.debts ?? []).filter(
    (d) => d.status === 'current' || d.status === 'delinquent',
  );
  if (live.length === 0) return '_Nobody owes anybody._';
  return live
    .map((d) => {
      const creditor = getFaction(state, d.creditorFactionId)?.name ?? d.creditorFactionId;
      const debtor = getFaction(state, d.debtorFactionId)?.name ?? d.debtorFactionId;
      const behind =
        d.status === 'delinquent'
          ? ` — IN DEFAULT, ${d.missedPayments} payment(s) missed`
          : '';
      return `  - \`${d.id}\` ${debtor} owes ${creditor} ${d.balance} of ${d.principal}, at ${d.perTurn}/turn${behind}.\n    _as agreed, in their words: ${d.text}_`;
    })
    .join('\n');
}
