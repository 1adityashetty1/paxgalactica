/**
 * "Meridian Trade Authority's", "Arkane Free Worlds'": a name made possessive.
 * A leaf, so anything that writes a sentence can import it. The Free Worlds
 * read as "Arkane Free Worlds's" in some eighty lines (bughunt 2026-10-28).
 */
export function possessive(name: string): string {
  return /s$/.test(name) ? `${name}'` : `${name}'s`;
}
