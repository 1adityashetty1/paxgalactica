import { z } from 'zod';
import { StatNameSchema, type FactionStats, type StatName } from './checks.js';

/**
 * Estates and notables: the shapes, the sheets and the numbers.
 * `docs/design-2026-10-07-seats.md`.
 *
 * A leaf, as `events.ts` is: `state.ts` builds its schemas from it, so nothing
 * here may import from `state.ts`. Everything that reads the whole world —
 * who fills a seat, what a notable does, where favour is drifting — lives in
 * `seats.ts`.
 *
 * Each power has three **estates**, one behind each of its three weakest base
 * stats. The two strongest belong to its **institutions** — the Trade Council,
 * the fleet commanders, the old cousins, the councils, the captains — which
 * dissent already speaks for, and no estate moves them. An estate's **favour**
 * is a straight modifier on its stat, by one table for every estate.
 */

export const EstateSchema = z.object({
  /** `<factionId>:<slug>`, so the power an estate belongs to is in its id. */
  id: z.string().regex(/^[a-z0-9_-]+:[a-z0-9_]+$/),
  /** How it is named in a sentence, article included where it takes one. */
  name: z.string().min(1).max(40),
  /** The one stat it stands behind: one of the power's three weakest. */
  stat: StatNameSchema,
  /** −100 to 100. Drifts toward a baseline of seats held and grants paid. */
  favour: z.number().int().min(-100).max(100).default(0),
  /** Stipends paid it, each `GRANT_COST` a turn. A marriage abroad is a grant too, counted off the notables. */
  stipends: z.number().int().min(0).default(0),
});
export type Estate = z.infer<typeof EstateSchema>;

/**
 * A named person in a world's seat — or, while held abroad as a ward or a
 * prisoner, in nobody's.
 *
 * Two facts of their own: the estate they belong to, and whom they are
 * married to. Everything else they do is read off their estate's favour, so a
 * notable is one record with no rules of its own.
 */
export const NotableSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** The estate they belong to; `null` for an independent world's notable. */
  estateId: z.string().nullable(),
  /** The world whose seat they sit; `null` while held as an asset. */
  systemId: z.string().nullable(),
  /** The notable they are married to — the one record of a marriage. */
  spouseId: z.string().nullable().default(null),
});
export type Notable = z.infer<typeof NotableSchema>;

/** The power an estate belongs to, read off its id. */
export function estateOwner(estateId: string): string {
  return estateId.slice(0, estateId.indexOf(':'));
}

/**
 * Each power's three estates, weakest stat first. Authored with the faction
 * sheets: who a power's institutions are is character. A test holds that none
 * sits on a power's two strongest base stats.
 *
 * | power | estates | institutions (no estate) |
 * |---|---|---|
 * | Meridian | Standards & Practices, the Security Directorate, the Creatives | industry, influence |
 * | Iron Vigil | the Blue Bloods, the Intelligentsia, the Complex | resolve, might |
 * | Ojjul Nar | the Made Men, the Blood Nars, the Spice Cartel | influence, guile |
 * | Arkane | the Shipbreakers, the Bards & Poets, the Sentinels | guile, resolve |
 * | Drajk | the Open Hand, the Salt Compact, the Sixteenth | guile, might |
 */
export const ESTATE_SHEETS: Record<string, readonly { slug: string; name: string; stat: StatName }[]> = {
  meridian: [
    { slug: 'standards', name: 'Standards & Practices', stat: 'resolve' },
    { slug: 'security', name: 'the Security Directorate', stat: 'might' },
    { slug: 'creatives', name: 'the Creatives', stat: 'guile' },
  ],
  vigil: [
    { slug: 'bluebloods', name: 'the Blue Bloods', stat: 'influence' },
    { slug: 'intelligentsia', name: 'the Intelligentsia', stat: 'guile' },
    { slug: 'complex', name: 'the Complex', stat: 'industry' },
  ],
  ojjul: [
    { slug: 'mademen', name: 'the Made Men', stat: 'might' },
    { slug: 'bloodnars', name: 'the Blood Nars', stat: 'resolve' },
    { slug: 'spice', name: 'the Spice Cartel', stat: 'industry' },
  ],
  freeworlds: [
    { slug: 'shipbreakers', name: 'the Shipbreakers', stat: 'industry' },
    { slug: 'bards', name: 'the Bards & Poets', stat: 'influence' },
    { slug: 'sentinels', name: 'the Sentinels', stat: 'might' },
  ],
  drajk: [
    // The Confederacy's own covenant words: the Sixteenth is the crews' share
    // and so the crews, the Salt Compact binds the other corsair fleets, and
    // the Open Hand is the ports given quarter.
    { slug: 'openhand', name: 'the Open Hand', stat: 'industry' },
    { slug: 'saltcompact', name: 'the Salt Compact', stat: 'influence' },
    { slug: 'sixteenth', name: 'the Sixteenth', stat: 'resolve' },
  ],
};

/** A power's opening estates, at favour 0 with nothing granted. */
export function seedEstates(factionId: string): Estate[] {
  return (ESTATE_SHEETS[factionId] ?? []).map((e) =>
    EstateSchema.parse({ id: `${factionId}:${e.slug}`, name: e.name, stat: e.stat }),
  );
}

/* ------------------------------------------------------------------ */
/* Favour                                                              */
/* ------------------------------------------------------------------ */

/** Favour drifts this share of the gap to its baseline a turn, rounded up — the fade standing uses. */
export const FAVOUR_FADE = 0.1;
/** For each seat an estate holds above its fair share (a third of the power's), and against it for each below. */
export const SEAT_FAVOUR = 20;
/** For each grant an estate holds: a stipend, or one of its notables married abroad. */
export const GRANT_FAVOUR = 20;
/** Grants an estate can hold, stipends and marriages together. */
export const MAX_GRANTS = 3;
/** What a stipend costs, a turn. */
export const GRANT_COST = 15;
/** Taken off at once when a stipend is revoked: an estate notices being cut more than being paid. */
export const REVOKED_FAVOUR = 15;
/** Against an estate's baseline for each of its notables sitting a world not content with its holder. */
export const HATED_SEAT_FAVOUR = 10;

/** At or above, a notable lifts its world for its holder; the +1 band starts here. */
export const FAVOURED = 40;
/** At or above, the +2 band. */
export const DOTING = 80;
/** At or below, a notable withholds and sours; the −1 band starts here. A foreign or turned notable acts here. */
export const RESENTFUL = -40;
/** At or below, a notable lets a world that is not content go; the −2 band. */
export const BITTER = -80;

/** What an estate's favour does to its stat. */
export function favourModifier(favour: number): number {
  if (favour >= DOTING) return 2;
  if (favour >= FAVOURED) return 1;
  if (favour <= BITTER) return -2;
  if (favour <= RESENTFUL) return -1;
  return 0;
}

/** What a power's estates do to its stats, read beside fixtures and the rally. */
export function estateBonus(estates: readonly Estate[] | undefined): Partial<FactionStats> {
  const bonus: Partial<FactionStats> = {};
  for (const e of estates ?? []) {
    const m = favourModifier(e.favour);
    if (m !== 0) bonus[e.stat] = (bonus[e.stat] ?? 0) + m;
  }
  return bonus;
}

/** One step of the drift toward a baseline: a tenth of the gap, rounded up, as standing moves. */
export function driftToward(favour: number, baseline: number): number {
  const gap = baseline - favour;
  const next = favour + Math.sign(gap) * Math.ceil(Math.abs(gap) * FAVOUR_FADE);
  return Math.max(-100, Math.min(100, Math.round(next)));
}

/* ------------------------------------------------------------------ */
/* Seats                                                               */
/* ------------------------------------------------------------------ */

/** A hub — strategic value 7 or more, the trade network's own line — carries a second seat. */
export const HUB_SEATS = 2;
/** What reseating a world costs its regard for its holder. */
export const RESEAT_REGARD = 5;
/** What a favoured notable lifts its world's regard for its holder by, a turn; a resentful one lowers it as much. Halved on a hub, per notable. */
export const NOTABLE_REGARD = 4;
/** The share of a world's income a resentful notable withholds; halved on a hub, per notable. */
export const WITHHOLD_SHARE = 0.5;

/* ------------------------------------------------------------------ */
/* Marriage, wards and the knife                                       */
/* ------------------------------------------------------------------ */

/** Added to a spouse's world's baseline regard toward the in-laws. */
export const MARRIAGE_REGARD = 30;
/** An independent world accepts a match from a power it regards at least this well. */
export const MARRIAGE_CONSENT_REGARD = 40;
/** A killed notable's world, toward its holder, in the confusion. */
export const ASSASSINATION_REGARD = 10;
