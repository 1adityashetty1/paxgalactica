import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps } from '../src/domain/reducer.js';
import { worldAsSeenBy } from '../src/domain/intel.js';
import { courtLines, courtView, seatDoing } from '../src/ui/court.js';
import { seatedAt } from '../src/domain/seats.js';
import { serializeState } from '../src/model/serialize.js';
import { helpPage } from '../src/ui/help.js';

/** The court as the player sees it: the tab, the briefing, the fog, the prompt, the help. */
describe('the court, seen', () => {
  it('lays out each estate, and lists a conquest’s foreign seat as costing you', () => {
    let s = createSeedState('meridian');
    const kalzir = s.systems.find((x) => x.name === 'Kalzir')!;
    s = applyOps(s, [{ op: 'transfer_control', systemId: kalzir.id, toFactionId: 'meridian' }], 'engine').state;
    const view = courtView(s, 'meridian')!;
    expect(view.estates.map((e) => e.name)).toEqual(['Standards & Practices', 'the Security Directorate', 'the Creatives']);
    expect(view.trouble.map((t) => t.world)).toContain('Kalzir');
    expect(courtLines(s, 'meridian').some((l) => l.tone === 'bad' && l.text.includes('Kalzir'))).toBe(true);
    expect(seatDoing(s, seatedAt(s, kalzir.id)[0]!)).toMatch(/foreign/);
  });

  it('shows a rival’s estates by name and hides their favour and stipends', () => {
    const s = createSeedState('meridian');
    const vigil = s.factions.find((f) => f.id === 'vigil')!;
    vigil.estates[0]!.favour = 63;
    vigil.estates[0]!.stipends = 2;
    const seen = worldAsSeenBy(s, 'meridian').factions.find((f) => f.id === 'vigil')!;
    expect(seen.estates.map((e) => e.name)).toEqual(vigil.estates.map((e) => e.name));
    expect(seen.estates[0]!.favour).toBe(0);
    expect(seen.estates[0]!.stipends).toBe(0);
    // Known well enough, the band shows and nothing finer.
    s.factions.find((f) => f.id === 'meridian')!.intel = { vigil: 45 };
    expect(worldAsSeenBy(s, 'meridian').factions.find((f) => f.id === 'vigil')!.estates[0]!.favour).toBe(40);
    // Your own are whole.
    expect(worldAsSeenBy(s, 'vigil').factions.find((f) => f.id === 'vigil')!.estates[0]!.favour).toBe(63);
  });

  it('puts the court and every seat in the state block', () => {
    const s = createSeedState('vigil');
    const block = serializeState(s, 'vigil');
    expect(block).toMatch(/Your estates/);
    expect(block).toMatch(/the Blue Bloods \(`vigil:bluebloods`, influence\)/);
    expect(block).toMatch(/seats: .*`nob-/);
  });

  it('has a help page, found by its name and its aliases', () => {
    const s = createSeedState('vigil');
    for (const q of ['court', 'estates', 'marriage', 'help-seats']) expect(helpPage(s, q).found, q).toBe(true);
    expect(helpPage(s, 'court').lines.join(' ')).toMatch(/the Blue Bloods \(influence\)/);
  });
});
