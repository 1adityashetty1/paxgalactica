import { describe, expect, it } from 'vitest';
import { HELP_TOPICS, exampleActions, helpIndex, helpPage, helpTopic } from '../src/ui/help.js';
import { AGENT_COST, AGENT_MISSIONS, TREATY_TYPES } from '../src/domain/diplomacy.js';
import { RIM_EVENT_TITLE } from '../src/domain/events.js';
import { createSeedState } from '../src/seed/scenario.js';

/**
 * `:help` is an index and a page per part of the game. One page grew to some
 * two hundred lines; these hold the split to what makes it usable — every
 * page reachable by the words a player would type, nothing printed twice by
 * accident, and nothing wider than the feed.
 */
describe('the help pages', () => {
  const state = createSeedState('meridian');

  it('lists every page on the index', () => {
    const index = helpIndex(state).join('\n');
    for (const t of HELP_TOPICS) expect(index).toMatch(new RegExp(`^  ${t.key} `, 'm'));
  });

  it('reaches a page by its name, an alias, a prefix, or the help-<topic> form', () => {
    expect(helpTopic('war')?.key).toBe('war');
    expect(helpTopic('espionage')?.key).toBe('espionage');
    expect(helpTopic('spies')?.key).toBe('espionage');
    expect(helpTopic('Treaties')?.key).toBe('diplomacy');
    expect(helpTopic('esp')?.key).toBe('espionage');
    expect(helpTopic('help-events')?.key).toBe('events');
    expect(helpTopic(':help-trade')?.key).toBe('trade');
  });

  it('gives every word one page and no more', () => {
    const words = HELP_TOPICS.flatMap((t) => [t.key, ...t.aliases]);
    expect(new Set(words).size).toBe(words.length);
    for (const t of HELP_TOPICS) for (const w of [t.key, ...t.aliases]) expect(helpTopic(w)?.key, w).toBe(t.key);
  });

  it('answers a word it does not know with the index, and says so', () => {
    const page = helpPage(state, 'teleportation');
    expect(page.found).toBe(false);
    expect(page.lines).toEqual(helpIndex(state));
    expect(helpPage(state).found).toBe(true);
  });

  it('prints every page for "all"', () => {
    const all = helpPage(state, 'all').lines.join('\n');
    for (const t of HELP_TOPICS) expect(all).toContain(t.lines(state).join('\n'));
  });

  it('keeps every line of every page as narrow as the feed', () => {
    for (const id of ['meridian', 'vigil', 'ojjul', 'freeworlds', 'drajk']) {
      for (const line of helpPage(createSeedState(id), 'all').lines) {
        expect(line.length, line).toBeLessThanOrEqual(76);
      }
    }
    for (const line of helpPage(null, 'all').lines) expect(line.length, line).toBeLessThanOrEqual(76);
  });

  it('names every treaty type on the diplomacy page', () => {
    const page = helpPage(state, 'diplomacy').lines.join('\n');
    for (const t of TREATY_TYPES) {
      expect(page).toContain(t.replace(/_/g, ' ').replace('defense', 'defence'));
    }
  });

  it('prices every mission on the espionage page at what it costs to send', () => {
    const page = helpPage(state, 'espionage').lines;
    for (const m of AGENT_MISSIONS) {
      const row = page.find((l) => l.trim().startsWith(m));
      expect(row, m).toBeDefined();
      expect(row).toContain(`${AGENT_COST[m]}cr`);
    }
  });

  it('names every event the Rim can draw on the events page', () => {
    const page = helpPage(state, 'events').lines.join(' ');
    for (const title of Object.values(RIM_EVENT_TITLE)) expect(page.replace(/\s+/g, ' ')).toContain(title);
  });

  it('shows examples on the index that name worlds the player holds', () => {
    for (const id of ['meridian', 'vigil', 'ojjul', 'freeworlds', 'drajk']) {
      const s = createSeedState(id);
      const from = /from (.+) to take/.exec(exampleActions(s).join('\n'))?.[1];
      if (from) expect(s.systems.find((x) => x.name === from)?.controllerFactionId, id).toBe(id);
      expect(helpIndex(s).join('\n')).toContain(exampleActions(s)[0]!);
    }
    expect(helpIndex(null).join('\n')).not.toMatch(/TRY THESE/);
  });
});
