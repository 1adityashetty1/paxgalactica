import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps, tickTurn } from '../src/domain/reducer.js';
import {
  fleetStrengthOf,
  hullsAt,
  ledgerFor,
  setStackAt,
  stackAt,
  type WorldState,
} from '../src/domain/state.js';
import { drawMatching, isLoanLive } from '../src/domain/loan.js';
import { driftingCompulsions } from '../src/domain/compulsions.js';
import type { OpInput } from '../src/domain/ops.js';

/**
 * Loans — the instrument a hired squadron actually is.
 *
 * A debt's balance depletes through its flow; a loan's principal comes back
 * whole and the flow runs the other way as rent. The tests that matter are the
 * ones about that difference, and about the two places moving hulls between
 * powers could quietly cost or mint a fleet.
 */
describe('loans', () => {
  const seed = () => createSeedState('ojjul');
  /** A world the Combine holds, with a mixed squadron standing on it. */
  const withSquadron = (): { state: WorldState; systemId: string } => {
    const state = seed();
    const home = state.systems.find((s) => s.controllerFactionId === 'ojjul')!;
    setStackAt(home, 'ojjul', { battleship: 8, escort: 6, lifter: 2 });
    return { state, systemId: home.id };
  };
  const hire = (systemId: string, over: Record<string, unknown> = {}): OpInput =>
    ({
      op: 'establish_loan',
      lenderFactionId: 'ojjul',
      borrowerFactionId: 'drajk',
      lent: { kind: 'hulls', stack: { battleship: 4, escort: 2 }, atSystemId: systemId },
      rentPerTurn: 40,
      termTurns: 3,
      text: 'The Sixteenth serves under Drajk colours.',
      ...over,
    }) as OpInput;

  it('cannot be declared, because it binds the borrower', () => {
    const { state, systemId } = withSquadron();
    const declared = applyOps(state, [hire(systemId)], 'model', 'ojjul');
    expect(declared.rejections[0]?.code).toBe('needs_consent');
    expect(declared.state.loans).toHaveLength(0);

    const agreed = applyOps(state, [hire(systemId)], 'extraction', 'ojjul');
    expect(agreed.rejections).toEqual([]);
    expect(agreed.state.loans).toHaveLength(1);
  });

  it('changes the flag on the squadron, and is neither built nor lost', () => {
    const { state, systemId } = withSquadron();
    const beforeCredits = state.factions.find((f) => f.id === 'drajk')!.credits;
    const beforeLender = fleetStrengthOf(state, 'ojjul');

    const out = applyOps(state, [hire(systemId)], 'extraction', 'ojjul');
    expect(out.rejections).toEqual([]);
    const site = out.state.systems.find((s) => s.id === systemId)!;

    // The whole content of a hire: the borrower commands it, counts it, and
    // feeds it. It comes free, because a fleet here is `system.ships[id]`.
    expect(stackAt(site, 'drajk')).toEqual({ battleship: 4, escort: 2 });
    expect(stackAt(site, 'ojjul')).toEqual({ battleship: 4, escort: 4, lifter: 2 });
    expect(fleetStrengthOf(out.state, 'ojjul')).toBe(beforeLender - 6);

    // Hulls that changed flag under a signature are NOT a purchase. Without the
    // exemption `billConstruction` charges the borrower 22 tons at 15 a ton for
    // ships it is renting.
    expect(out.state.factions.find((f) => f.id === 'drajk')!.credits).toBe(beforeCredits);
    // And the lender's fleet shrinking is not a scuttling for
    // `capSelfInflictedLosses` to undo — which would put the squadron back and
    // leave two of it.
    expect(hullsAt(site, 'ojjul') + hullsAt(site, 'drajk')).toBe(16);
  });

  it('takes rent from the borrower every turn, outside net', () => {
    const { state, systemId } = withSquadron();
    const s = applyOps(state, [hire(systemId)], 'extraction', 'ojjul').state;

    expect(ledgerFor(s, 'ojjul').loanRent).toBe(40);
    expect(ledgerFor(s, 'drajk').loanRent).toBe(-40);
    // Reported, never summed into `net` — settled as a transfer against what
    // the borrower can actually find, exactly as debt service is. So the hire
    // itself moves `net` by nothing at all.
    expect(ledgerFor(s, 'ojjul').net - ledgerFor(state, 'ojjul').net).toBe(
      // What DOES move is real and worth pinning: the lender stops paying
      // upkeep on 20 tons, and a foreign flag now stands over its own world and
      // contests its income. The reducer cannot tell a hired squadron from an
      // invasion fleet by looking at a stack, and must not try — so hiring your
      // fleet out at home costs you the contest, and handing it over at a
      // border world does not.
      20 - (ledgerFor(state, 'ojjul').territory - ledgerFor(s, 'ojjul').territory),
    );
    expect(ledgerFor(s, 'ojjul').territory).toBeLessThan(ledgerFor(state, 'ojjul').territory);

    // Against a control identical in every way except the hire, so income,
    // debt service and upkeep cancel and only the rent is left.
    const free = applyOps(state, [hire(systemId, { rentPerTurn: 0 })], 'extraction', 'ojjul').state;
    const paid = tickTurn(s).state;
    const gratis = tickTurn(free).state;
    const moved = (a: WorldState, b: WorldState, id: string) =>
      a.factions.find((f) => f.id === id)!.credits - b.factions.find((f) => f.id === id)!.credits;
    expect(moved(paid, gratis, 'ojjul')).toBe(40);
    expect(moved(paid, gratis, 'drajk')).toBe(-40);
  });

  it('comes home when the term runs out, class for class', () => {
    const { state, systemId } = withSquadron();
    let s = applyOps(state, [hire(systemId)], 'extraction', 'ojjul').state;
    for (let i = 0; i < 3; i++) s = tickTurn(s).state;

    const loan = s.loans[0]!;
    expect(loan.status).toBe('returned');
    expect(loan.outstanding).toBeNull();
    // A lender who sent four battleships is not made whole by four lifters.
    const home = s.systems.find((x) => x.id === systemId)!;
    expect(stackAt(home, 'ojjul')).toEqual({ battleship: 8, escort: 6, lifter: 2 });
    expect(hullsAt(home, 'drajk')).toBe(0);
  });

  it('is the same default whether the squadron died or the borrower kept it', () => {
    const { state, systemId } = withSquadron();
    let s = applyOps(state, [hire(systemId)], 'extraction', 'ojjul').state;
    // The hire is spent: the borrower has nothing of that class anywhere.
    for (const sys of s.systems) if (hullsAt(sys, 'drajk') > 0) setStackAt(sys, 'drajk', {});
    const disposedBefore = s.factions.find((f) => f.id === 'ojjul')!.disposition['drajk'] ?? 0;

    const witnessBefore = s.factions.find((f) => f.id === 'meridian')!.disposition['drajk'] ?? 0;

    for (let i = 0; i < 3; i++) s = tickTurn(s).state;
    // Bad luck and bad faith reach ONE state, deliberately: a lender does not
    // care why twelve hulls did not come home, and every other obligation here
    // charges for *unpaid* rather than for *unwilling*.
    expect(s.loans[0]!.status).toBe('defaulted');
    // Public, unlike missed rent — a squadron that never sailed home is
    // observable, so onlookers charge too.
    expect(s.factions.find((f) => f.id === 'meridian')!.disposition['drajk']).toBe(
      witnessBefore - 10,
    );
    expect(s.loans[0]!.outstanding).toEqual({
      kind: 'hulls',
      stack: { battleship: 4, escort: 2 },
      atSystemId: systemId,
    });
    // The one-time hit on the turn the term ran out, and a bleed every turn
    // after that for as long as it stays out.
    expect(s.factions.find((f) => f.id === 'ojjul')!.disposition['drajk']!).toBe(
      disposedBefore - 25,
    );
    expect(
      tickTurn(s).state.factions.find((f) => f.id === 'ojjul')!.disposition['drajk'],
    ).toBe(disposedBefore - 25 - 6);

    // Hulls are fungible, so an equivalent squadron settles it — which is what
    // "give it back" has to mean when nothing tracks a hull's history. But it
    // is a deliberate act now, not the tick reaching in again: once the
    // relationship is what broke, making good is a choice.
    const drajkWorld = s.systems.find((x) => x.controllerFactionId === 'drajk')!;
    setStackAt(drajkWorld, 'drajk', { battleship: 5, escort: 3 });
    expect(tickTurn(s).state.loans[0]!.status).toBe('defaulted');
    s = applyOps(s, [{ op: 'return_loan', loanId: s.loans[0]!.id }], 'model', 'drajk').state;
    expect(s.loans[0]!.status).toBe('returned');
    expect(stackAt(s.systems.find((x) => x.id === systemId)!, 'ojjul')).toEqual({
      battleship: 8,
      escort: 6,
      lifter: 2,
    });
    // Making it good clears the status and never the standing. Disposition has
    // no decay, so a power that once failed to hand a squadron back is
    // remembered for it whatever it returns afterwards.
    expect(s.factions.find((f) => f.id === 'ojjul')!.disposition['drajk']!).toBeLessThan(
      disposedBefore,
    );
  });

  it('can be kept, which is what makes the term an obligation', () => {
    const { state, systemId } = withSquadron();
    const s = applyOps(state, [hire(systemId)], 'extraction', 'ojjul').state;
    const id = s.loans[0]!.id;

    // A lender cannot declare that its own property has been stolen.
    const wrong = applyOps(s, [{ op: 'repudiate_loan', loanId: id }], 'model', 'ojjul');
    expect(wrong.rejections[0]?.code).toBe('illegal_value');

    // Without this op a loan is the one instrument in the game that cannot be
    // betrayed — the tick hands the squadron back whether the borrower likes it
    // or not, which makes it a scheduled transfer with a fee.
    const before = s.factions.find((f) => f.id === 'ojjul')!.disposition['drajk'] ?? 0;
    const kept = applyOps(s, [{ op: 'repudiate_loan', loanId: id }], 'model', 'drajk');
    expect(kept.rejections).toEqual([]);
    expect(kept.state.loans[0]!.status).toBe('defaulted');
    expect(kept.state.factions.find((f) => f.id === 'ojjul')!.disposition['drajk']).toBe(
      before - 25,
    );
    // The hulls stay with the borrower, and go on being theirs to command.
    expect(hullsAt(kept.state.systems.find((x) => x.id === systemId)!, 'drajk')).toBe(6);

    // And it bleeds every turn it stays out, whatever the term said — a
    // squadron repudiated on turn 0 of a three-turn hire is out now.
    const after = tickTurn(kept.state).state;
    expect(after.factions.find((f) => f.id === 'ojjul')!.disposition['drajk']!).toBeLessThan(
      before - 25,
    );
  });

  it('charges for missed hire, privately', () => {
    const { state, systemId } = withSquadron();
    let s = applyOps(state, [hire(systemId, { termTurns: 20 })], 'extraction', 'ojjul').state;
    s.factions.find((f) => f.id === 'drajk')!.credits = 0;
    const lenderBefore = s.factions.find((f) => f.id === 'ojjul')!.disposition['drajk'] ?? 0;
    const witnessBefore = s.factions.find((f) => f.id === 'meridian')!.disposition['drajk'] ?? 0;

    const after = tickTurn(s).state;
    expect(after.loans[0]!.status).toBe('delinquent');
    expect(after.loans[0]!.missedPayments).toBe(1);
    // A hire fee you could simply decline to pay cost a status flag and a
    // counter. It bleeds with the lender now — but with nobody else, because a
    // missed payment is not observable to anyone who is not owed it.
    expect(after.factions.find((f) => f.id === 'ojjul')!.disposition['drajk']).toBe(
      lenderBefore - 6,
    );
    expect(after.factions.find((f) => f.id === 'meridian')!.disposition['drajk']).toBe(
      witnessBefore,
    );
  });

  it('is handed back by the borrower and by nobody else', () => {
    const { state, systemId } = withSquadron();
    const s = applyOps(state, [hire(systemId)], 'extraction', 'ojjul').state;
    const id = s.loans[0]!.id;

    // A lender cannot reach into another power's fleet and sail its ships home.
    const seized = applyOps(s, [{ op: 'return_loan', loanId: id }], 'model', 'ojjul');
    expect(seized.rejections[0]?.code).toBe('illegal_value');

    const given = applyOps(s, [{ op: 'return_loan', loanId: id }], 'model', 'drajk');
    expect(given.rejections).toEqual([]);
    expect(given.state.loans[0]!.status).toBe('returned');
    // And returning is not a purchase either, in either direction.
    expect(given.state.factions.find((f) => f.id === 'ojjul')!.credits).toBe(
      s.factions.find((f) => f.id === 'ojjul')!.credits,
    );
  });

  it('is forgiven by the lender alone, and buys the same goodwill a debt does', () => {
    const { state, systemId } = withSquadron();
    const s = applyOps(state, [hire(systemId)], 'extraction', 'ojjul').state;
    const id = s.loans[0]!.id;

    const kept = applyOps(s, [{ op: 'forgive_loan', loanId: id }], 'model', 'drajk');
    expect(kept.rejections[0]?.code).toBe('illegal_value');

    const before = s.factions.find((f) => f.id === 'drajk')!.disposition['ojjul'] ?? 0;
    const gift = applyOps(s, [{ op: 'forgive_loan', loanId: id }], 'model', 'ojjul');
    expect(gift.rejections).toEqual([]);
    expect(gift.state.loans[0]!.status).toBe('forgiven');
    expect(gift.state.factions.find((f) => f.id === 'drajk')!.disposition['ojjul']).toBe(
      before + 20,
    );
    // The squadron stays where it is. That is what a gift means.
    expect(hullsAt(gift.state.systems.find((x) => x.id === systemId)!, 'drajk')).toBe(6);
  });

  it('advances credits that come back whole, which a debt cannot express', () => {
    const state = seed();
    const s = applyOps(
      state,
      [
        {
          op: 'establish_loan',
          lenderFactionId: 'ojjul',
          borrowerFactionId: 'drajk',
          lent: { kind: 'credits', amount: 400 },
          rentPerTurn: 20,
          termTurns: 1,
          text: 'A facility against the season.',
        },
      ],
      'extraction',
      'ojjul',
    ).state;
    // A loan MOVES the money, exactly as `establish_debt` does.
    expect(s.factions.find((f) => f.id === 'ojjul')!.credits).toBe(
      state.factions.find((f) => f.id === 'ojjul')!.credits - 400,
    );
    expect(s.factions.find((f) => f.id === 'drajk')!.credits).toBe(
      state.factions.find((f) => f.id === 'drajk')!.credits + 400,
    );

    const after = tickTurn(s).state;
    expect(after.loans[0]!.status).toBe('returned');
    // The principal came back WHOLE and the rent ran the other way — the shape
    // a `Debt`'s depleting balance cannot say.
    expect(after.loans[0]!.outstanding).toBeNull();
  });

  it('lends a portable thing and refuses a fixture', () => {
    const state = seed();
    const world = state.systems.find((x) => x.controllerFactionId === 'ojjul')!;
    const s = applyOps(
      state,
      [
        {
          op: 'create_asset', kind: 'codex', heldBy: 'ojjul', quantity: 1, unit: 'codex',
          text: 'The Shalka star-codex.', divisible: false, valuePerUnit: { drajk: 300 },
          atSystemId: world.id,
        },
        {
          op: 'create_asset', kind: 'exchange', heldBy: 'ojjul', quantity: 1, unit: 'works',
          text: 'The Shalka exchange.', divisible: false, valuePerUnit: {},
          atSystemId: world.id, portable: false,
        },
      ],
      'model',
      'ojjul',
    ).state;
    const [codex, exchange] = s.assets;

    const lend = (assetId: string, from: WorldState = s) =>
      applyOps(
        from,
        [
          {
            op: 'establish_loan', lenderFactionId: 'ojjul', borrowerFactionId: 'drajk',
            lent: { kind: 'asset', assetId }, rentPerTurn: 0, termTurns: null,
            text: 'On loan to the Confederacy archivists.',
          },
        ],
        'extraction',
        'ojjul',
      );

    // A fixture goes with its world and by no other route, so there is no
    // version of lending one that is not a cession.
    expect(lend(exchange!.id).rejections[0]?.code).toBe('illegal_value');

    const out = lend(codex!.id);
    expect(out.rejections).toEqual([]);
    expect(out.state.assets.find((a) => a.id === codex!.id)!.heldBy).toBe('drajk');

    // And the borrower cannot sell, split or re-lend what it has to give back —
    // it IS `heldBy`, so every guard keying on the holder waves it through.
    const sold = applyOps(
      out.state,
      [{ op: 'transfer_asset', assetId: codex!.id, toFactionId: 'meridian' }],
      'extraction',
      'drajk',
    );
    expect(sold.rejections[0]?.code).toBe('illegal_value');
    const relent = lend(codex!.id, out.state);
    expect(relent.rejections[0]?.code).toBe('illegal_value');
  });

  it('is trimmed to the squadron that is actually standing there', () => {
    const { state, systemId } = withSquadron();
    const out = applyOps(
      state,
      [hire(systemId, { lent: { kind: 'hulls', stack: { battleship: 40 }, atSystemId: systemId } })],
      'extraction',
      'ojjul',
    );
    expect(out.rejections).toEqual([]);
    // The board is a better bound than a constant, which is why a hull loan
    // carries no ceiling of its own.
    expect(out.state.loans[0]!.lent).toEqual({
      kind: 'hulls',
      stack: { battleship: 8 },
      atSystemId: systemId,
    });
  });

  it('trims the hire and refuses a loan to oneself', () => {
    const { state, systemId } = withSquadron();
    const greedy = applyOps(state, [hire(systemId, { rentPerTurn: 5000 })], 'extraction', 'ojjul');
    expect(greedy.state.loans[0]!.rentPerTurn).toBe(60);

    const self = applyOps(state, [hire(systemId, { borrowerFactionId: 'ojjul' })], 'extraction', 'ojjul');
    expect(self.rejections[0]?.code).toBe('illegal_value');
  });

  it('draws matching classes, never the cheapest thing on the books', () => {
    // The unit under the return. `takeHulls` spends the loss order, which would
    // hand a lender four escorts for four battleships.
    const { taken, short } = drawMatching(
      { battleship: 2, escort: 9, lifter: 4 },
      { battleship: 4, escort: 2 },
    );
    expect(taken).toEqual({ battleship: 2, escort: 2 });
    expect(short).toEqual({ battleship: 2 });
  });

  it('is something the Combine is obliged to pursue', () => {
    // 94(a). `debt_unpursued` read `state.debts` alone, so a hired squadron
    // three turns past due and unchased cost its lender nothing — against a
    // sheet that says an unpaid debt must be PURSUED. The line says *unpaid*,
    // and a borrower keeping your ships is exactly the client it describes.
    const { state, systemId } = withSquadron();
    // Clear the seeded debts, so what fires can only be the loan.
    state.debts = [];
    let s = applyOps(state, [hire(systemId)], 'extraction', 'ojjul').state;
    for (const sys of s.systems) if (hullsAt(sys, 'drajk') > 0) setStackAt(sys, 'drajk', {});
    expect(driftingCompulsions(s, 'ojjul').some((d) => d.trigger === 'debt_unpursued')).toBe(
      false,
    );

    for (let i = 0; i < 3; i++) s = tickTurn(s).state;
    expect(s.loans[0]!.status).toBe('defaulted');
    const drifting = driftingCompulsions(s, 'ojjul');
    expect(drifting.some((d) => d.trigger === 'debt_unpursued')).toBe(true);

    // And pursuit is still read as pressure actually applied — an operative in
    // their space answers it, exactly as it does for a debt.
    const chased = {
      ...s,
      agents: [
        {
          id: 'agt-x', ownerFactionId: 'ojjul', targetFactionId: 'drajk',
          systemId: s.systems.find((x) => x.controllerFactionId === 'drajk')!.id,
          mission: 'surveillance' as const, effect: { kind: 'intel' as const, revealsOrders: true },
          cover: 'a factor', deployedTurn: 0, exposed: false, successChance: 50,
        },
      ],
    };
    expect(
      driftingCompulsions(chased, 'ojjul').some((d) => d.trigger === 'debt_unpursued'),
    ).toBe(false);
  });

  it('stays live while anything is outstanding', () => {
    const { state, systemId } = withSquadron();
    const s = applyOps(state, [hire(systemId)], 'extraction', 'ojjul').state;
    expect(isLoanLive(s.loans[0]!)).toBe(true);
  });
});
