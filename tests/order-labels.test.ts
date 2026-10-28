import { describe, expect, it } from 'vitest';
import { createSeedState } from '../src/seed/scenario.js';
import { applyOps } from '../src/domain/reducer.js';

describe('an unlabelled order', () => {
  it('says what it is and where, so two envoys in flight are two rows', () => {
    const out = applyOps(
      createSeedState('ojjul'),
      [
        { op: 'send_envoy', factionId: 'ojjul', systemId: 'sek-5' },
        { op: 'send_envoy', factionId: 'ojjul', systemId: 'ilv-4' },
        { op: 'fortify', factionId: 'ojjul', systemId: 'ilv-2', magnitude: 1 },
      ],
      'model',
      'ojjul',
      true,
      {},
      'declared',
    );
    expect(out.rejections).toEqual([]);
    expect(out.state.pendingOrders.filter((o) => o.factionId === 'ojjul').map((o) => o.label)).toEqual([
      'envoy to Var Hollow',
      'envoy to Vosk Marker',
      'fortification at Shalka',
    ]);
  });

  it('keeps a label the writer gave it', () => {
    const out = applyOps(createSeedState('ojjul'), [{ op: 'send_envoy', factionId: 'ojjul', systemId: 'sek-5', label: 'court the Hollow' }], 'model', 'ojjul', true, {}, 'declared');
    expect(out.state.pendingOrders.at(-1)!.label).toBe('court the Hollow');
  });
});
