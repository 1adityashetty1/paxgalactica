import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';

/**
 * `docs/design-2026-10-18-code-knows.md`, end to end.
 *
 * Every scenario drives the stateless server — `handleStateless`, the route the
 * browser calls — one request at a time, with a fresh store each time, so the
 * only thing carried between requests is the session snapshot, exactly as in
 * play. The model is scripted, and every scripted answer is parsed through the
 * schema the real call hands the model, so an answer no model could give is a
 * test failure rather than a pass. Each scenario ends by rebuilding the
 * campaign from its journal and comparing it with the live world.
 */

const calls: { kind: string; user: string }[] = [];
let queue: Record<string, unknown[]> = {};
/** Answers for calls that may or may not happen, used when nothing is queued. */
const fallback: Record<string, unknown> = {
  event_flavour: { line: 'The lanes go quiet for a while.' },
  reaction: undefined,
};

vi.mock('../src/model/client.js', () => ({
  callStructured: async (call: { kind: string; user: string; schema: z.ZodType }) => {
    calls.push({ kind: call.kind, user: call.user });
    const next = queue[call.kind]?.shift() ?? fallback[call.kind];
    if (next === undefined) throw new Error(`No scripted response for a "${call.kind}" call.`);
    const parsed = call.schema.safeParse(next);
    if (!parsed.success) {
      throw new Error(`Scripted "${call.kind}" answer fails its own schema: ${JSON.stringify(parsed.error.issues.slice(0, 3))}`);
    }
    return { value: parsed.data, attempts: 1, costUsd: 0 };
  },
  stats: { calls: 0, costUsd: 0, retries: 0 },
}));

const { ROUTES } = await import('../src/api/contract.js');
type CampaignView = import('../src/api/contract.js').CampaignView;
const { MemoryCampaignStore } = await import('../src/engine/store.js');
const { GameSession } = await import('../src/server/session.js');
type SessionSnapshot = import('../src/server/session.js').SessionSnapshot;
type CampaignT = import('../src/engine/campaign.js').Campaign;
type GameSessionT = import('../src/server/session.js').GameSession;
const { handleStateless } = await import('../src/server/stateless.js');
const { JOURNAL_VERSION } = await import('../src/engine/journal.js');
const { REGARD_BECAUSE } = await import('../src/domain/acts.js');
const { charterWorth } = await import('../src/domain/state.js');
const { ExtractionOutputSchema } = await import('../src/domain/ops.js');

beforeEach(() => {
  calls.length = 0;
  queue = {};
});

/** One request, on a server that has never seen this campaign. */
async function post(path: string, session: SessionSnapshot | null, body: unknown = {}) {
  const res = await handleStateless('POST', path, { session, body }, { store: new MemoryCampaignStore() });
  if (res.result.status !== 200) throw new Error(`${path} answered ${res.result.status}: ${JSON.stringify(res.result.body)}`);
  return { body: res.result.body as Record<string, unknown>, session: res.session! };
}

async function start(factionId: string, extra: object = {}): Promise<SessionSnapshot> {
  return (await post(ROUTES.newCampaign, null, { factionId, name: `ck-${factionId}`, ...extra })).session;
}

const view = async (session: SessionSnapshot) => (await post(ROUTES.campaign, session)).body as unknown as CampaignView;

/** The campaign inside a snapshot, to read its journal or set a board the API has no route for. */
function open(session: SessionSnapshot): { s: GameSessionT; campaign: CampaignT } {
  const s = new GameSession(new MemoryCampaignStore());
  s.restore(session);
  return { s, campaign: (s as unknown as { campaign: CampaignT }).campaign };
}

function replaysExactly(session: SessionSnapshot): void {
  const { campaign } = open(session);
  expect(campaign.toSaveFile().journal.version).toBe(JOURNAL_VERSION);
  expect(campaign.verifyReplay().ok).toBe(true);
}

const regard = (v: CampaignView, of: string, toward: string) =>
  v.state.factions.find((f) => f.id === of)!.disposition[toward] ?? 0;
const appraisalClean = { admissible: true, reason: '', stat: 'influence', difficulty: 10, rationale: 'a plain sale' };
const reactionQuiet = (factionId: string) => ({ factionId, narrative: 'The answer is a silence, for now.', ops: [] });

/* ------------------------------------------------------------------ */
/* §2–3 and §8: an accord built from the record, its warmth priced     */
/* ------------------------------------------------------------------ */

describe('a sale agreed in a channel (§2–3, §8)', () => {
  it('moves the thing and the price once, from the record, and warms by the table', async () => {
    let session = await start('meridian');
    const before = await view(session);

    queue = {
      diplomacy: [
        {
          reply: 'Five hundred, and the drawings are yours. The yard notes stay with us.',
          concessions: [
            { by: 'vigil', kind: 'sell_drawings', text: 'The Vigil hands over the line-of-battle drawings.', assets: ['ast-0-1'] },
            { by: 'meridian', kind: 'price', text: 'Meridian pays five hundred credits.', credits: 500 },
          ],
        },
      ],
      // The player's own concession is appraised as it is made.
      appraisal: [appraisalClean],
    };
    session = (await post(ROUTES.talk('vigil'), session, { text: 'Your drawings, for five hundred.' })).session;

    queue = {
      extraction: [
        {
          narrative: 'The drawings change hands for five hundred credits.',
          accepted: ['vigil:sell_drawings', 'meridian:price'],
          // Extraction should write only what has no field — here, the warmth —
          // and writes the payment anyway, the old mistake: it is left out.
          ops: [
            { op: 'regard', factionId: 'vigil', toward: 'meridian', because: 'promise_kept' },
            { op: 'pay', factionId: 'meridian', to: 'vigil', amount: 500 },
          ],
        },
      ],
      appraisal: [appraisalClean, appraisalClean],
      reconcile: [{ narrative: 'The drawings change hands, and the price with them.' }],
    };
    const closed = await post(ROUTES.endtalk('vigil'), session);
    session = closed.session;
    expect(closed.body.rejections).toEqual([]);
    const ops = closed.body.ops as { op: string }[];
    // Built by the engine from the ids each power wrote down, once each.
    expect(ops.filter((o) => o.op === 'pay')).toEqual([{ op: 'pay', factionId: 'meridian', to: 'vigil', amount: 500, for: 'the terms agreed' }]);
    expect(ops.filter((o) => o.op === 'transfer_asset')).toHaveLength(1);

    const staged = await view(session);
    expect(staged.state.assets.find((a) => a.id === 'ast-0-1')!.heldBy).toBe('meridian');
    expect(regard(staged, 'vigil', 'meridian') - regard(before, 'vigil', 'meridian')).toBe(REGARD_BECAUSE.promise_kept);

    queue = { reaction: [reactionQuiet('vigil')] };
    session = (await post(ROUTES.endturn, session)).session;
    const { campaign } = open(session);
    const accord = campaign.journal.entries.find((e: { kind: string; path?: string }) => e.kind === 'ops' && e.path === 'accord') as { ops: { op: string }[] };
    expect(accord.ops.filter((o) => o.op === 'pay')).toHaveLength(1);
    replaysExactly(session);
  });

  it('warms nobody for a conversation that agreed nothing', async () => {
    let session = await start('meridian');
    const before = await view(session);
    queue = { diplomacy: [{ reply: 'We have nothing to sell you today.', concessions: [] }] };
    session = (await post(ROUTES.talk('vigil'), session, { text: 'A pleasant hour, nothing more.' })).session;
    queue = {
      extraction: [
        { narrative: 'They part civilly.', accepted: [], ops: [{ op: 'regard', factionId: 'vigil', toward: 'meridian', because: 'deference' }] },
      ],
      appraisal: [appraisalClean, appraisalClean],
    };
    const closed = await post(ROUTES.endtalk('vigil'), session);
    expect((closed.body.notes as string[]).join(' ')).toMatch(/agreed nothing/);
    expect(regard(await view(closed.session), 'vigil', 'meridian')).toBe(regard(before, 'vigil', 'meridian'));
  });

  it('cannot narrate warmth any more: the extraction schema refuses it', () => {
    const narrated = { op: 'adjust_disposition', factionId: 'vigil', towardFactionId: 'meridian', delta: 20 };
    expect(ExtractionOutputSchema.safeParse({ narrative: 'x', accepted: [], ops: [narrated] }).success).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* §4 and §5: a declaration held to its ruling, and told as it landed  */
/* ------------------------------------------------------------------ */

describe('a declaration that reaches past its ruling (§4, §5)', () => {
  it('drops the reach, and the story the player and the reactions see is the one that landed', async () => {
    let session = await start('meridian');
    queue = {
      appraisal: [
        { kind: 'act', parts: [{ kind: 'overt', what: 'fortify Brannix', stat: 'industry', difficulty: 2 }] },
      ],
      resolution: [
        {
          narrative: 'Brannix raises its walls, and three Vigil crews come over to the Authority in the bargain.',
          ops: [
            { op: 'fortify', factionId: 'meridian', systemId: 'sek-4', magnitude: 1 },
            { op: 'suborn_crews', factionId: 'meridian', fromFactionId: 'vigil', systemId: 'tor-1', count: 3 },
          ],
        },
      ],
      reconcile: [{ narrative: 'Brannix raises its walls. The Vigil crews stay where they are.' }],
    };
    const declared = await post(ROUTES.action, session, { text: 'Fortify Brannix.' });
    session = declared.session;
    const ops = declared.body.ops as { op: string }[];
    expect(ops.some((o) => o.op === 'suborn_crews')).toBe(false);
    expect((declared.body.notes as string[]).join(' ')).toMatch(/only as it was ruled/);
    expect(calls.map((c) => c.kind)).toContain('reconcile');
    expect(declared.body.narrative).toBe('Brannix raises its walls. The Vigil crews stay where they are.');
    // The batch the turn's reactions read carries the same story.
    expect((await view(session)).staged.map((b) => b.narrative)).toContain(declared.body.narrative);

    session = (await post(ROUTES.endturn, session)).session;
    replaysExactly(session);
  });
});

/* ------------------------------------------------------------------ */
/* §1 and §5: a line read off the acts, and an ending that remembers   */
/* ------------------------------------------------------------------ */

describe('a declaration that crosses a line, ten turns before the end (§1, §5)', () => {
  it('is refused off its acts, and the epilogue still says so when dissent has faded', async () => {
    let session = await start('meridian', { maxTurns: 10 });
    queue = {
      // The arbiter names no breach: the act alone is what crosses the line.
      appraisal: [{ kind: 'act', parts: [{ kind: 'overt', what: 'close Torrek Anchorage', stat: 'might', difficulty: 2 }] }],
      resolution: [
        { narrative: 'The Authority closes the lane at Torrek Anchorage.', ops: [{ op: 'blockade', factionId: 'meridian', systemId: 'tor-1' }] },
      ],
    };
    const declared = await post(ROUTES.action, session, { text: 'Blockade Torrek Anchorage.' });
    session = declared.session;
    expect(declared.body.refusal).not.toBeNull();
    expect(JSON.stringify(declared.body.refusal)).toMatch(/close a lane/);

    queue = { epilogue: [] };
    for (let turn = 0; turn < 10; turn++) {
      if (turn === 9) {
        queue.epilogue = [
          {
            slides: ['meridian', 'vigil', 'ojjul', 'freeworlds', 'drajk'].map((factionId) => ({ factionId, text: 'It endured.' })),
            closing: 'The Rim went on.',
          },
        ];
      }
      session = (await post(ROUTES.endturn, session)).session;
    }
    const finale = await view(session);
    expect(finale.state.factions.find((f) => f.id === 'meridian')!.dissent).toBe(0);
    const prompt = calls.find((c) => c.kind === 'epilogue')!.user;
    const meridian = prompt.slice(prompt.indexOf('(`meridian`)'), prompt.indexOf('(`vigil`)'));
    expect(meridian).toMatch(/refused its orders once/);
    expect(meridian).not.toMatch(/stood behind it throughout/);
    replaysExactly(session);
  });
});

/* ------------------------------------------------------------------ */
/* §7: a charter declared, paid from its world, and lost with it       */
/* ------------------------------------------------------------------ */

describe('a charter declared through the API (§7)', () => {
  it('pays from its world in the ledger the player sees, and nothing once the world is gone', async () => {
    let session = await start('meridian');
    queue = {
      appraisal: [
        {
          kind: 'act',
          parts: [
            {
              kind: 'overt',
              what: 'charter Brannix as a free port',
              stat: 'influence',
              difficulty: 2,
              establishes: { kind: 'free_port', factionIds: ['meridian'], text: 'Brannix is a free port.', mechanism: 'income' },
            },
          ],
        },
      ],
      resolution: [
        {
          narrative: 'Brannix is chartered a free port, and the dues come in.',
          ops: [
            {
              op: 'establish_commitment', kind: 'free_port', factionIds: ['meridian'],
              text: 'Brannix is a free port.', incomePerTurn: 25, systemId: 'sek-4',
            },
          ],
        },
      ],
      reconcile: [{ narrative: 'Brannix is chartered a free port, and its dues are what the port can bear.' }],
    };
    const declared = await post(ROUTES.action, session, { text: 'Charter Brannix as a free port.' });
    session = declared.session;
    expect(declared.body.rejections).toEqual([]);

    session = (await post(ROUTES.endturn, session)).session;
    const after = await view(session);
    const charter = after.state.commitments.find((c) => c.kind === 'free_port')!;
    expect(charter.atSystemId).toBe('sek-4');
    const pays = charterWorth(after.state, charter, 'meridian');
    expect(pays).toBeGreaterThan(0);
    expect(pays).toBeLessThan(25);
    expect(after.effective.ledger?.commitmentFlow).toBe(pays);

    // The world is lost; the API has no route for that, so the engine commits it.
    const { s, campaign } = open(session);
    campaign.commit([{ op: 'transfer_control', systemId: 'sek-4', toFactionId: 'vigil', reason: 'lost' }], 'engine', 'lost Brannix');
    session = s.snapshot()!;
    expect((await view(session)).effective.ledger?.commitmentFlow).toBe(0);
    replaysExactly(session);
  });
});
