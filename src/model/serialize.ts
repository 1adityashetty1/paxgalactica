import { eventsVisibleTo, ordersVisibleTo } from '../domain/intel.js';
import { describeOrderEffect } from '../domain/development.js';
import { describeEffect } from '../domain/diplomacy.js';
import {
  formatModifier,
  statModifier,
  STAT_NAMES,
  type FactionStats,
} from '../domain/checks.js';
import {
  dissentPenalty,
  dispositionBetween,
  getFaction,
  getSystem,
  isMovementType,
  agentsVisibleTo,
  fleetStrengthOf,
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

export function serializeFactions(state: WorldState, viewerId: string): string {
  const lines = state.factions.map((f) => {
    const held = state.systems.filter((s) => s.controllerFactionId === f.id).length;
    const self = f.id === viewerId ? ' — THIS IS YOU' : '';
    const toward =
      f.id === viewerId
        ? ''
        : ` | disposition toward ${viewerId}: ${fmtDisposition(dispositionBetween(state, f.id, viewerId))}`;
    return [
      `- **${f.name}** (id: \`${f.id}\`)${self}`,
      `  fleet ${fleetStrengthOf(state, f.id)} | credits ${f.credits} | ${held} systems${toward}`,
      `  stats: ${serializeStats(f.stats)}`,
      `  war: ${f.warEthic} — ${WAR_ETHIC_MEANING[f.warEthic]}`,
      `  trade: ${f.tradeEthic} — ${TRADE_ETHIC_MEANING[f.tradeEthic]}`,
      `  doctrine: ${f.doctrine}`,
    ].join('\n');
  });
  return lines.join('\n');
}

/**
 * The full character sheet for one power, used wherever a faction has to ACT
 * or SPEAK as itself rather than merely be observed.
 */
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
 * dialect notes for writing dialogue and, for Arkanis, several thousand tokens
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
    lines.push(`  - \`${t.id}\` ${t.type.replace(/_/g, ' ')} with ${other} (${until}) — ${t.summary}`);
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
      `  - \`${a.id}\` ${mine ? 'YOURS' : `${a.ownerFactionId} (exposed)`} on ${where}: ${a.mission}, ${describeEffect(a.effect)}, ${a.successChance}% per turn${a.exposed ? ' — BURNED' : ''}`,
    );
  }

  return lines.join('\n');
}

export function serializeSystems(state: WorldState): string {
  const bySector = new Map<string, string[]>();
  for (const s of state.systems) {
    const controller = s.controllerFactionId
      ? getFaction(state, s.controllerFactionId)?.name ?? s.controllerFactionId
      : 'unaligned';
    const income = systemIncome(state, s);
    const ships = Object.entries(s.ships ?? {})
      .filter(([, n]) => n > 0)
      .map(([id, n]) => `${id} ${n}`)
      .join(', ');
    const payout = Object.entries(income.shares)
      .filter(([, v]) => v > 0)
      .map(([id, v]) => `${id} ${v}`)
      .join(', ');
    const line = [
      `  - \`${s.id}\` ${s.name} — held by ${controller}, garrison ${s.garrison}, value ${s.strategicValue}${income.contested ? ', CONTESTED' : ''}`,
      `      ships: ${ships || 'none'} | pays: ${payout || 'nobody'} | lanes: ${s.hyperlaneEdges.join(', ') || 'none'}`,
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
export function serializeState(state: WorldState, viewerId: string): string {
  const viewer = getFaction(state, viewerId);
  const ledger = ledgerFor(state, viewerId);
  return [
    `# Galaxy state — turn ${state.turn}`,
    '',
    `Viewpoint: **${viewer?.name ?? viewerId}** (\`${viewerId}\`)`,
    `Treasury: ${viewer?.credits ?? 0} credits · income ${ledger.gross}/turn (${ledger.territory} territory + ${ledger.routes} trade lanes), upkeep ${ledger.upkeep}/turn (net ${ledger.net >= 0 ? '+' : ''}${ledger.net})`,
    ledger.tolls > 0 ? `Tolls levied on other powers' cargo: ${ledger.tolls}/turn.` : '',
    ledger.raided > 0 ? `Taken by commerce raiding: ${ledger.raided}/turn.` : '',
    // Dissent reduces every stat the model is reasoning about. Omitting it
    // meant a leader could be told its own odds had worsened with no way to
    // know why, and could not narrate the reason to the player either.
    viewer && viewer.dissent > 0
      ? `Internal dissent: ${viewer.dissent}/100 — your institutions have been overruled once too often, and every capability below is already reduced by ${dissentPenalty(viewer.dissent)}. It falls 2 a turn if you stop.`
      : '',
    '',
    '## Factions',
    serializeFactions(state, viewerId),
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
    serializeCommitments(state),
    '',
    '## Debts',
    serializeDebts(state),
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
export function serializeCommitments(state: WorldState): string {
  const live = (state.commitments ?? []).filter((c) => c.status === 'active');
  if (live.length === 0) return '_None. Nothing beyond treaties currently binds anyone._';

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
      return `- \`${c.id}\` ${c.kind.replace(/_/g, ' ')} · ${who} · since turn ${c.establishedTurn}${worth}${flag}\n  ${c.text}`;
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
      return `  - \`${d.id}\` ${debtor} owes ${creditor} ${d.balance} of ${d.principal}, at ${d.perTurn}/turn${behind}. ${d.text}`;
    })
    .join('\n');
}
