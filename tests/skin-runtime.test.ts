import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

/**
 * What the game writes while the null lexicon is in force, prompts included.
 *
 * `docs/design-2026-11-15-skins.md`, *"Leak prevention"* 3. The static scan
 * reads the source; this reads the output, so it also catches a table read at
 * module load, a word passed through from somewhere unscanned, and every word
 * a prompt file holds. Each path the suite can drive without a model or a
 * browser is driven:
 *
 * - sixty turns of the five doctrine bots: every log line and every briefing;
 * - every Rim event, through the sandbox that fires one kind every turn;
 * - every help page, the index and the worked examples;
 * - the epilogue's dossier and its fallback ending;
 * - every kind of model call, built against a mocked client that records the
 *   system prompt, the user message and the JSON schema it would send.
 *
 * Under the null lexicon the dice differ from Pax Galactica's, because the
 * operative salt still reads the log's last word (decision 8, phase 3), so this
 * is a different campaign from the default's, and a deterministic one.
 *
 * Each source is held to the setting words recorded for it in
 * `skin-runtime.baseline.json`: a source may lose words and never gain one.
 * The prompts carry most of them until phase 6 rewrites the prompt files, and
 * the schemas until phase 4 gives the protocol neutral words.
 *
 *   SKIN_LEAKS_RECORD=1 npx vitest run tests/skin-runtime.test.ts
 */

type Captured = { kind: string; system: string; user: string; schema: string };
const captured: Captured[] = [];

/** A call the scan has what it needs from: recorded, then refused, so the caller stops. */
class CapturedCall extends Error {}

vi.mock('../src/model/client.js', () => ({
  callStructured: async (call: { kind: string; system: string; user: string; schema: z.ZodType }) => {
    captured.push({
      kind: call.kind,
      system: call.system,
      user: call.user,
      schema: JSON.stringify(z.toJSONSchema(call.schema, { target: 'draft-7', io: 'input' })),
    });
    // The arbiter's answer lets a declaration go on to resolution, whose prompt is the one worth reading.
    if (call.kind === 'appraisal') {
      return {
        value: { admissible: true, stat: 'industry', difficulty: 12, reason: 'ok', establishes: null, breach: null, negotiation: null, covert: [] },
        attempts: 1,
        costUsd: 0,
      };
    }
    throw new CapturedCall(call.kind);
  },
  stats: { calls: 0, costUsd: 0, retries: 0, byKind: {}, failures: [] },
}));

const { runBalance } = await import('../src/balance.js');
const { createSeedState } = await import('../src/seed/scenario.js');
const { Campaign, MemoryCampaignStore } = await import('../src/engine/campaign.js');
const { buildBriefing, briefingFromState } = await import('../src/engine/briefing.js');
const { campaignOutcome, fallbackEpilogue, serializeOutcome } = await import('../src/engine/epilogue.js');
const { HELP_TOPICS, exampleActions, helpIndex, helpPage } = await import('../src/ui/help.js');
const { RIM_EVENT_KINDS } = await import('../src/domain/events.js');
const calls = await import('../src/model/calls.js');
const { withLexicon, withLexiconAsync } = await import('../src/skin/lexicon.js');
const { nullLexicon } = await import('../src/skin/null.js');
const { leakedWords, scenarioStrings, stringsIn } = await import('./helpers/runtime-scan.js');
type WorldState = import('../src/domain/state.js').WorldState;

const BASELINE = join(import.meta.dirname, 'skin-runtime.baseline.json');
const NULL = nullLexicon();

/** Setting words found so far, by where they were written. */
const found: Record<string, Set<string>> = {};
function scan(source: string, texts: readonly string[], scenario: readonly string[]): void {
  const words = leakedWords(texts, scenario);
  const into = (found[source] ??= new Set());
  for (const w of words) into.add(w);
}

/** A sixty-turn bot campaign under the null lexicon: every log line by kind, and every briefing. */
function driveHarness(): WorldState {
  const seed = createSeedState('freeworlds');
  let last: WorldState = seed;
  let seen = 0;
  withLexicon(NULL, () => {
    runBalance(60, (_snap, state) => {
      const scenario = scenarioStrings(state, seed);
      const fresh = state.eventLog.slice(seen);
      seen = state.eventLog.length;
      const byKind = new Map<string, string[]>();
      for (const e of fresh) byKind.set(e.kind, [...(byKind.get(e.kind) ?? []), e.text]);
      for (const [kind, texts] of byKind) scan(`log:${kind}`, texts, scenario);
      scan('briefing', stringsIn(briefingFromState(state)), scenario);
      last = state;
    });
  });
  return last;
}

describe('the game, written under the null lexicon', () => {
  it('writes no more setting words, path by path, than it did when last recorded', async () => {
    const end = driveHarness();

    // Every Rim event: a sandbox fires its kind at the player every turn.
    withLexicon(NULL, () => {
      for (const kind of RIM_EVENT_KINDS) {
        const c = Campaign.start('freeworlds', `sandbox_${kind}`, new MemoryCampaignStore(), undefined, kind);
        const seed = c.state;
        for (let t = 0; t < 3; t++) {
          const { report, notes } = c.tick();
          const scenario = scenarioStrings(c.state, seed);
          scan(`rim:${kind}`, [...c.state.rimEvents.map((e) => e.text), ...notes, ...stringsIn(buildBriefing(c.state, report))], scenario);
        }
      }
    });

    // Every help page, the index and the worked examples.
    const help = createSeedState('meridian');
    withLexicon(NULL, () => {
      const scenario = scenarioStrings(help);
      scan('help:index', helpIndex(help), scenario);
      scan('help:examples', exampleActions(help), scenario);
      for (const t of HELP_TOPICS) scan(`help:${t.key}`, helpPage(help, t.key).lines, scenario);
    });

    // The epilogue: the dossier a model is handed, and the ending written without one.
    withLexicon(NULL, () => {
      const outcome = campaignOutcome(end, createSeedState('freeworlds'), 60);
      const scenario = scenarioStrings(end, createSeedState('freeworlds'));
      scan('epilogue:dossier', [serializeOutcome(outcome)], scenario);
      scan('epilogue:fallback', stringsIn(fallbackEpilogue(outcome)), scenario);
    });

    // Every kind of model call, against the end of the bot campaign.
    captured.length = 0;
    const them = end.factions.find((f) => f.id !== end.playerFactionId)!.id;
    const said = [{ speaker: 'player' as const, text: 'We would buy passage through your space.' }];
    const attempt = async (run: () => Promise<unknown>) => {
      try {
        await run();
      } catch (e) {
        if (!(e instanceof CapturedCall)) throw e;
      }
    };
    await withLexiconAsync(NULL, async () => {
      await attempt(() => calls.resolveAction(end, 'Raise the garrison at our best world.'));
      await attempt(() => calls.appraiseAgreement(end, them, 'They lift their toll on us for five turns.'));
      await attempt(() => calls.verifyBreachRelevance('Pay tribute to a rival.', end.factions[0]!.redLines[0]!, 'red_line', end.factions[0]!));
      await attempt(() => calls.gatherReactions(end, [them], 'A garrison was raised.'));
      await attempt(() => calls.diplomacyReply(end, them, said, []));
      await attempt(() => calls.extractAgreements(end, them, said));
      await attempt(() => calls.askAdvisor(end));
      await attempt(() => calls.reconcileNarrative('The walls went up.', 'raise_garrison +2', ['Trimmed to the ceiling.']));
      await attempt(() => calls.dressRimEvent('Unrest', 'Unrest at a world: half its garrison is lost.'));
      await attempt(() => calls.narrateEpilogue('the dossier', 'the characters'));
    });
    const scenario = scenarioStrings(end, createSeedState('freeworlds'));
    for (const c of captured) {
      scan(`prompt:${c.kind}:system`, [c.system], scenario);
      scan(`prompt:${c.kind}:user`, [c.user], scenario);
      scan(`schema:${c.kind}`, [c.schema], scenario);
    }
    const kinds = new Set(captured.map((c) => c.kind));
    expect([...kinds].sort()).toEqual(
      ['advisor', 'appraisal', 'breach_relevance', 'diplomacy', 'epilogue', 'event_flavour', 'extraction', 'reaction', 'reconcile', 'resolution'].sort(),
    );

    const now = Object.fromEntries(
      Object.entries(found)
        .filter(([, words]) => words.size > 0)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([source, words]) => [source, [...words].sort()]),
    );
    if (process.env.SKIN_LEAKS_RECORD) {
      writeFileSync(BASELINE, `${JSON.stringify(now, null, 2)}\n`);
      return;
    }
    const was: Record<string, string[]> = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
    const gained = Object.entries(now).flatMap(([source, words]) =>
      words.filter((w) => !(was[source] ?? []).includes(w)).map((w) => `${source}: ${w}`),
    );
    const lost = Object.entries(was).flatMap(([source, words]) =>
      words.filter((w) => !(now[source] ?? []).includes(w)).map((w) => `${source}: ${w}`),
    );
    expect(gained, 'the game writes a setting word that does not come from the lexicon').toEqual([]);
    expect(lost, 'a setting word no longer reaches the output; record the new baseline with SKIN_LEAKS_RECORD=1').toEqual([]);
  }, 240_000);
});
