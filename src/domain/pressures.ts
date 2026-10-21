import { buildAdjacency } from './graph.js';
import { HULL_SPEC, LIFTER_CARRY } from './hulls.js';
import { statModifier } from './checks.js';
import { effectiveStats, getFaction, ledgerFor, orbitalWeightAt, stackAt, systemIncome, type WorldState } from './state.js';
import { driftingCompulsions } from './compulsions.js';
import { JOIN_LEAD, JOIN_REGARD } from './regard.js';
import { NOTE_TITLE, isNote } from './diplomacy.js';

/**
 * What presses on a power, computed rather than read (playtest 2026-10-19, S6).
 *
 * The counsellor read the same flat state block every prompt gets, in which a
 * massing fleet is one stack among twenty: it never mentioned eleven Vigil
 * lifters a jump from Torrek Anchorage, invented a position at Neth and called
 * the player's own garrison the Vigil's. Code knows each of these; the
 * counsellor's job is to choose among them and speak.
 */
export function pressuresOn(state: WorldState, me: string): string[] {
  const adjacency = buildAdjacency(state.systems);
  const byId = new Map(state.systems.map((s) => [s.id, s]));
  const be = HULL_SPEC.battleship.orbitalWeight;
  const name = (id: string) => getFaction(state, id)?.name ?? id;
  const out: string[] = [];

  for (const world of state.systems.filter((s) => s.controllerFactionId === me)) {
    const mine = orbitalWeightAt(world, me) / be;
    const rivals = new Map<string, { line: number; troops: number; over: number; staged: Map<string, number> }>();
    for (const id of [world.id, ...(adjacency.get(world.id) ?? [])]) {
      const sys = byId.get(id);
      if (!sys) continue;
      for (const f of Object.keys(sys.ships)) {
        // A power that likes you is not massing against you; one in your
        // orbit is still named, whatever it thinks of you.
        if (f === me) continue;
        if (id !== world.id && (getFaction(state, f)?.disposition[me] ?? 0) > 0) continue;
        const row = rivals.get(f) ?? { line: 0, troops: 0, over: 0, staged: new Map<string, number>() };
        const line = orbitalWeightAt(sys, f) / be;
        row.line += line;
        const lift = (stackAt(sys, f).lifter ?? 0) * LIFTER_CARRY;
        row.troops += lift;
        if (lift > 0) row.staged.set(sys.name, (row.staged.get(sys.name) ?? 0) + lift);
        if (id === world.id) row.over += line;
        rivals.set(f, row);
      }
    }
    for (const [f, r] of rivals) {
      if (r.over > 0) {
        const take = systemIncome(state, world).shares[me] ?? 0;
        out.push(
          `${name(f)} has ${r.over.toFixed(1)} battleships' weight in the orbit of ${world.name}, a world you hold (garrison ${world.garrison}, yours); you have ${mine.toFixed(1)} there, and the world pays you ${Math.round(take)} a turn of ${world.strategicValue * 7}.`,
        );
      }
      if (r.troops > world.garrison) {
        // Where the lift stands, and that it has not sailed; and what is on
        // the world's side too. A counsellor read "on or a jump from" as "is
        // moving to", invented a landing date, and weighed it against the
        // garrison alone while 36 troops of the player's own lift and nine
        // battleships stood over the world (playtest 2026-10-19, loop 2).
        const where = [...r.staged].map(([at, n]) => (at === world.name ? `${n} in its orbit` : `${n} at ${at}, a jump away`)).join(' and ');
        const ownLift = (stackAt(world, me).lifter ?? 0) * LIFTER_CARRY;
        out.push(
          `${name(f)} has lift for ${r.troops} troops within reach of ${world.name} (${where}); none of it has sailed, and nothing says when it will. On ${world.name}'s side: your garrison of ${world.garrison}, your own lift for ${ownLift} troops, and ${mine.toFixed(1)} battleships' weight in its orbit.`,
        );
      } else if (r.line > Math.max(mine, 0.5) * 1.5 && r.over === 0) {
        out.push(`${name(f)} has ${r.line.toFixed(1)} battleships' weight within a jump of ${world.name}, against your ${mine.toFixed(1)} there.`);
      }
    }
  }
  // The odds of the obvious answer. Twice a player who followed the counsel
  // attacked at even weight and both lines died — 21 against 19, 17 against 18
  // (playtest 2026-10-19, loop 2, L9). The exchange's own arithmetic: weight
  // times one plus a twentieth of the might modifier, and 2:1 to break the
  // defender off.
  const might = (f: string) => 1 + statModifier(effectiveStats(state, f, { seenBy: me }).might) / 20;
  for (const world of state.systems.filter((s) => s.controllerFactionId === me)) {
    const mine = (orbitalWeightAt(world, me) / be) * might(me);
    // Two lifters are not a battle line: "0.0:1" told nobody anything.
    if (mine < 0.5) continue;
    for (const id of adjacency.get(world.id) ?? []) {
      const base = byId.get(id);
      const holder = base?.controllerFactionId;
      if (!base || !holder || holder === me) continue;
      const them = getFaction(state, holder);
      // Only a power that dislikes you: odds against a near-neutral read as an invitation.
      if (!them || (them.disposition[me] ?? 0) > -25) continue;
      // The holder's own ships a jump from the base land in the batch that
      // answers an attack, and fought it: a 2.0:1 attack met 9 battleships
      // moved in from Vantic and was mutual ruin (playtest 2026-10-19, loop 3).
      const nearby = [...(adjacency.get(base.id) ?? [])]
        .map((n) => byId.get(n))
        .filter((n) => n !== undefined && n.controllerFactionId === holder)
        .reduce((w, n) => w + orbitalWeightAt(n!, holder), 0);
      const theirs = ((orbitalWeightAt(base, holder) + nearby) / be) * might(holder);
      if (theirs <= 0) continue;
      const ratio = mine / theirs;
      const holds = them.warEthic === 'crusading' ? ', and it never breaks off' : '';
      const verdict =
        ratio >= 2 && !holds
          ? 'enough that its line would break off'
          : ratio >= 1.5
            ? 'a win that costs a large part of your line'
            : ratio >= 1
              ? 'an even exchange: both lines would be spent and nothing taken'
              : 'too little: your line would be driven off';
      out.push(
        `If you attacked ${base.name} (${name(holder)}) with what stands at ${world.name}, it would be ${ratio.toFixed(1)}:1 counting what ${name(holder)} could move in from a jump away — ${verdict}${holds}. (These are the odds of YOUR attack, not of theirs on you.)`,
      );
    }
  }
  // Whose is whose, once, at the top: the counsellor called a world of the
  // player's "held" by the Vigil for one freighter in its orbit (playtest
  // 2026-10-19, loop 3). A ship in an orbit holds nothing.
  const held = state.systems.filter((s) => s.controllerFactionId === me).map((s) => s.name);
  const header = `Worlds you hold: ${held.join(', ') || 'none'}. A rival's ships in an orbit do not make the world theirs.`;
  return [header, ...[...new Set(out)].slice(0, 10)];
}

/**
 * The paper between a power and the others, stated whole, including what it
 * does not have (playtest 2026-10-19, loop 4). The counsellor urged "your
 * standing favour with Arkane" three turns running when none existed, and read
 * a debt to the Combine as a promissory note. Listing every favour, note and
 * debt — and saying "none" — leaves nothing to invent.
 */
export function paperOf(state: WorldState, me: string): string[] {
  const name = (id: string) => getFaction(state, id)?.name ?? id;
  const open = state.obligations.filter((o) => o.status === 'open');
  const owedMe = open.filter((o) => o.holderFactionId === me);
  const iOwe = open.filter((o) => o.debtorFactionId === me);
  const notes = state.assets.filter((a) => a.heldBy === me && isNote(a));
  const debts = state.debts.filter((d) => (d.creditorFactionId === me || d.debtorFactionId === me) && d.balance > 0 && (d.status === 'current' || d.status === 'delinquent'));
  const out: string[] = [];
  out.push(
    owedMe.length > 0
      ? `Favours owed to you: ${owedMe.map((o) => `${name(o.debtorFactionId)} (${o.strength}) — ${o.text}`).join('; ')}. Calling one in is an order of yours.`
      : 'Favours owed to you: none. There is no favour to call in with anybody.',
  );
  out.push(iOwe.length > 0 ? `Favours you owe: ${iOwe.map((o) => `to ${name(o.holderFactionId)} — ${o.text}`).join('; ')}.` : 'Favours you owe: none.');
  out.push(
    notes.length > 0
      ? `Promissory notes in your hands: ${notes.map((a) => (isNote(a) && a.issuedBy === me ? `your own ${NOTE_TITLE[a.note]} note — yours to give to another power, not to call in` : isNote(a) ? `${name(a.issuedBy)}'s ${NOTE_TITLE[a.note]} note — yours to call in` : a.kind)).join('; ')}.`
      : 'Promissory notes in your hands: none.',
  );
  out.push(
    debts.length > 0
      ? `Debts: ${debts.map((d) => (d.debtorFactionId === me ? `you owe ${name(d.creditorFactionId)} ${d.balance}, paid ${d.perTurn} a turn` : `${name(d.debtorFactionId)} owes you ${d.balance}, paid ${d.perTurn} a turn`)).join('; ')}. A debt is not a note.`
      : 'Debts: none.',
  );
  // The ledger and which demands of its institutions are pressing, computed:
  // the counsellor told a power netting +301 that "the Board will not accept
  // another quarter of red ink" (loop 6), reading a compulsion as live.
  const ledger = ledgerFor(state, me);
  out.push(
    // "Your treasury", not "net": the counsellor read a bare net figure as one
    // garrison's running cost (loop 7).
    `Your treasury: ${ledger.net >= 0 ? 'gains' : 'loses'} ${Math.abs(ledger.net)} a turn after every cost, across all your worlds (${ledger.gross} income, ${ledger.upkeep} fleet upkeep${ledger.debtService ? `, ${-ledger.debtService} debt service` : ''}); ${ledger.net > 0 ? 'the quarter is in the black' : 'the quarter is running at a loss'}.`,
  );
  // Where each world that answers to nobody stands with you, computed: the
  // counsellor called three worlds "at sixty regard and ready to join" while
  // the nearest stood at fourteen (loop 7).
  const unaligned = state.systems.filter((x) => x.controllerFactionId === null);
  if (unaligned.length > 0) {
    out.push(
      `Worlds that answer to nobody (one joins a power at ${JOIN_REGARD} standing, ${JOIN_LEAD} clear of the next; nobody appoints to them): ${unaligned
        .map((x) => {
          const mine = x.regard[me] ?? 0;
          const [rival, theirs] = Object.entries(x.regard).filter(([f]) => f !== me).sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
          return `${x.name} ${mine} with you${rival ? `, ${theirs} with ${name(rival)}` : ''}`;
        })
        .join('; ')}.`,
    );
  }
  // What is actually under way, computed: the counsellor urged "complete the
  // Ithaal development … we paid for the fortifications" when only envoys had
  // gone (loop 9).
  const mine = state.pendingOrders.filter((o) => o.factionId === me);
  const where = (id: string) => state.systems.find((x) => x.id === id)?.name ?? id;
  out.push(
    mine.length > 0
      ? `Your work under way (nothing else is): ${mine.map((o) => `${o.label || o.type.replace(/_/g, ' ')} at ${where(o.targetId)}, ${o.durationTurns - o.progress} turn${o.durationTurns - o.progress === 1 ? '' : 's'} to go`).join('; ')}.`
      : 'Your work under way: none. No programme, envoy or fleet of yours is in progress.',
  );
  const drifting = driftingCompulsions(state, me);
  out.push(
    drifting.length > 0
      ? `Demands of your institutions not being met now: ${drifting.map((d) => `"${d.text}" — ${d.why}`).join('; ')}.`
      : 'Demands of your institutions not being met now: none. Every standing demand on your sheet is satisfied this turn.',
  );
  return out;
}
