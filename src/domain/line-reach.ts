import type { WorldState } from './state.js';

/**
 * Whether a power holds the paper an act of going back on its word needs.
 *
 * A line tagged with the acts it forbids (`Faction.lineActs`) can only be
 * crossed by one of them, and most of those need something to break: a treaty,
 * a marriage, a favour owed, a loan, an arrangement sworn with another power.
 * Meridian's "will not repudiate a contract" refused a withdrawal from Torrek
 * Anchorage, handing its own note away and offering a seat — four times in
 * sixteen loops of the 2026-10-19 playtest — while Meridian held none of those
 * at all. That is a lookup, so code does it.
 *
 * Acts that need no paper (an attack, a blockade, a gift…) are always
 * reachable.
 */
export function actReachable(state: WorldState, actor: string, act: string): boolean {
  const live = state.treaties.filter((t) => t.parties.includes(actor) && (t.status === 'active' || t.status === 'pending'));
  switch (act) {
    case 'treaty_repudiated':
    case 'treaty_conceded':
    case 'attack_under_pact':
    case 'pact_attack_ordered':
      return live.length > 0;
    case 'marriage_repudiated':
    case 'match_betrayed':
    case 'attack_on_inlaws':
      return live.some((t) => t.type === 'marriage');
    case 'attack_across_truce':
      return state.truces.some((t) => t.parties.includes(actor) && t.status === 'active');
    case 'favour_repudiated':
      return state.obligations.some((o) => o.debtorFactionId === actor && o.status === 'open');
    case 'loan_defaulted':
      return state.loans.some((l) => l.borrowerFactionId === actor && !['returned', 'forgiven'].includes(l.status));
    case 'commitment_walked':
      return state.commitments.some((c) => c.status === 'active' && c.factionIds.includes(actor) && c.factionIds.length >= 2);
    default:
      return true;
  }
}

/** Whether any act a tagged line forbids is open to this power now; a line with no tags always is. */
export function lineCrossable(state: WorldState, actor: string, principle: string): boolean {
  const sheet = state.factions.find((f) => f.id === actor);
  const tag = sheet?.lineActs?.find((t) => t.text === principle);
  if (!tag) return true;
  return tag.forbids.some((act) => actReachable(state, actor, act));
}

/**
 * Whether code reads this line off what an act does (`Faction.lineActs`). A
 * tagged line is crossed when its acts are, and only then: a model reading the
 * Combine's "nothing given away for nothing" into a ransom it paid for its own
 * governor charged it for a deal with consideration on both sides (bughunt
 * 2026-10-28).
 */
export function lineReadByCode(state: WorldState, actor: string, principle: string): boolean {
  return state.factions.find((f) => f.id === actor)?.lineActs?.some((t) => t.text === principle) ?? false;
}
