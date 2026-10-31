/**
 * "Meridian Trade Authority's", "Arkane Free Worlds'": a name made possessive.
 * A leaf, so anything that writes a sentence can import it. The Free Worlds
 * read as "Arkane Free Worlds's" in some eighty lines (bughunt 2026-10-28).
 */
export function possessive(name: string): string {
  return /s$/.test(name) ? `${name}'` : `${name}'s`;
}

/**
 * A reason appended to a note, as a sentence of its own: "… are paid for. a
 * price on an enemy" ran a model's lower-case clause on after a full stop
 * (bughunt 2026-10-28). Empty stays empty.
 */
export function asSentence(text: string | undefined | null): string {
  const t = (text ?? '').trim();
  if (!t) return '';
  const head = t[0]!.toUpperCase() + t.slice(1);
  return /[.!?…)"']$/.test(head) ? head : `${head}.`;
}

/** "1 hull", "3 hulls". */
export function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "X completed at Y", unless the label already says where: "university at Vantic completed". */
export function doneAt(label: string, place: string): string {
  return label.includes(place) ? `${label} completed` : `${label} completed at ${place}`;
}
