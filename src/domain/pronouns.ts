import { GENERATED_PERSON_WORDS } from './command.js';

/**
 * Officers, operatives and notables are they/them, held in code.
 *
 * Their names are generated, so nothing says anything about them, and every
 * prompt that writes people says so. Prompts did not hold it: the counsellor
 * went on writing "his" and "she" of generated officers for loop after loop
 * (`docs/audit-2026-10-19.md`). So every model reply is passed through
 * `theyThem` before anything reads it (`callStructured`).
 *
 * A gendered pronoun is rewritten when its sentence names a generated person —
 * a stock name, an officer's title, or a role noun such as "governor" — and no
 * leader. With no person named, the sentence takes the last one named before
 * it. A leader's pronouns are on their sheet, so a sentence naming a leader is
 * left alone: telling which of the two a pronoun means there is a judgement,
 * and a wrong guess would misgender the leader instead.
 */

/** The five leaders' titles. A test holds them to the seed. */
export const LEADER_TITLES = ['Chief Executive', 'Grand Admiral', 'First Elder', 'Highwarden', 'Huntmaster'] as const;

const ROLE_NOUNS = [
  'officer', 'operative', 'agent', 'spy', 'governor', 'chancellor', 'notable', 'envoy', 'ward', 'spouse',
  'commander', 'captain', 'admiral', 'courier', 'prisoner', 'hostage', 'defector', 'informant',
];

const escape = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A stock name or title, case-sensitive; a family name also starts a joined one. */
const PERSON = new RegExp(
  `(?:\\b(?:${[...GENERATED_PERSON_WORDS].sort((a, b) => b.length - a.length).map(escape).join('|')}))` +
    `|(?:\\b(?:${ROLE_NOUNS.join('|')})s?\\b)`,
  'i',
);
const PERSON_NAME = new RegExp(
  `\\b(?:${[...GENERATED_PERSON_WORDS].sort((a, b) => b.length - a.length).map(escape).join('|')})`,
);
const ROLE = new RegExp(`\\b(?:${ROLE_NOUNS.join('|')})s?\\b`, 'i');
const LEADER = new RegExp(`\\b(?:${LEADER_TITLES.map(escape).join('|')})\\b|\\bleader\\b`, 'i');
const GENDERED = /\b(?:he|she|him|his|her|hers|himself|herself)\b|\b(?:he|she)['’](?:s|d|ll)\b/i;

/** Words after "her" that mean it is an object, not a possessive. */
const NOT_A_NOUN = new Set([
  'to', 'and', 'or', 'but', 'nor', 'in', 'on', 'at', 'from', 'with', 'for', 'of', 'by', 'as', 'into', 'onto',
  'out', 'off', 'up', 'down', 'again', 'away', 'back', 'aside', 'over', 'too', 'alone', 'so', 'that', 'than',
  'when', 'if', 'once', 'now', 'then', 'yet', 'until', 'before', 'after', 'about', 'through', 'home', 'free',
  'go', 'here', 'there', 'where', 'while', 'because', 'since', 'unless', 'is', 'was', 'a', 'an', 'the',
]);
const ADVERBS = new Set(['always', 'never', 'still', 'also', 'now', 'then', 'only', 'just', 'already', 'not', 'often', 'rarely', 'soon']);
const AGREE: Record<string, string> = {
  is: 'are', was: 'were', has: 'have', does: 'do', "doesn't": "don't", "isn't": "aren't", "wasn't": "weren't",
  "hasn't": "haven't", 'doesn’t': 'don’t', 'isn’t': 'aren’t', 'wasn’t': 'weren’t', 'hasn’t': 'haven’t',
};
/** Words ending in s after "he" that are not verbs to agree. */
const NOT_A_VERB = new Set(['thus', 'perhaps', 'always', 'sometimes', 'nevertheless', 'nonetheless', 'afterwards', 'towards']);

function caseLike(model: string, word: string): string {
  return model[0] === model[0]!.toUpperCase() ? word[0]!.toUpperCase() + word.slice(1) : word;
}

function plural(verb: string): string {
  const lower = verb.toLowerCase();
  if (AGREE[lower]) return caseLike(verb, AGREE[lower]!);
  if (!/^[a-z]+s$/i.test(verb) || /ss$/i.test(verb) || NOT_A_VERB.has(lower) || lower.length < 3) return verb;
  if (/[^aeiou]ies$/i.test(verb)) return verb.slice(0, -3) + 'y';
  if (/(?:sh|ch|x|z|o)es$/i.test(verb) || /sses$/i.test(verb)) return verb.slice(0, -2);
  return verb.slice(0, -1);
}

/** One sentence's gendered pronouns, as they/them, with the verb after a subject agreed. */
function rewriteSentence(sentence: string): string {
  let s = sentence.replace(/\b(he|she)(['’])(s|d|ll)\b(\s+(\w+))?/gi, (_m, p: string, q: string, c: string, tail?: string, next?: string) => {
    const they = caseLike(p, 'they');
    if (c.toLowerCase() === 's') {
      const has = next !== undefined && /^(?:been|got|gone|had|done|seen|made|taken|left|lost|won)$|ed$/i.test(next);
      return `${they}${q}${has ? 've' : 're'}${tail ?? ''}`;
    }
    return `${they}${q}${c}${tail ?? ''}`;
  });
  s = s.replace(/\b(he|she)\b(\s+)(\w+(?:['’]t)?)(?:(\s+)(\w+))?/gi, (_m, p: string, sp: string, w: string, sp2?: string, w2?: string) => {
    const they = caseLike(p, 'they');
    if (ADVERBS.has(w.toLowerCase()) && w2 !== undefined) return `${they}${sp}${w}${sp2}${plural(w2)}`;
    return `${they}${sp}${plural(w)}${sp2 ?? ''}${w2 ?? ''}`;
  });
  s = s.replace(/\b(?:he|she)\b/gi, (m) => caseLike(m, 'they'));
  s = s.replace(/\b(himself|herself)\b/gi, (m) => caseLike(m, 'themselves'));
  s = s.replace(/\bhers\b/gi, (m) => caseLike(m, 'theirs'));
  s = s.replace(/\bhis\b/gi, (m) => caseLike(m, 'their'));
  s = s.replace(/\bhim\b/gi, (m) => caseLike(m, 'them'));
  s = s.replace(/\bher\b(?=(\s*)([\w’']*))/gi, (m, _sp: string, next: string) => {
    const object = next === '' || NOT_A_NOUN.has(next.toLowerCase());
    return caseLike(m, object ? 'them' : 'their');
  });
  return s;
}

/** `text` with every pronoun about a generated person made they/them. */
export function theyThem(text: string): string {
  if (!GENDERED.test(text) || !PERSON.test(text)) return text;
  const split = text.match(/[^.!?\n]+(?:[.!?]+["”’)]*|\n+|$)\s*/g) ?? [];
  // A split that does not put the text back together exactly is not used.
  const sentences = split.join('') === text ? split : [text];
  let referent: 'generated' | 'leader' | null = null;
  return sentences
    .map((sentence) => {
      if (LEADER.test(sentence)) referent = 'leader';
      else if (PERSON_NAME.test(sentence) || ROLE.test(sentence)) referent = 'generated';
      return referent === 'generated' && GENDERED.test(sentence) ? rewriteSentence(sentence) : sentence;
    })
    .join('');
}

/** `value` with `theyThem` applied to every string in it, structure and key order kept. */
export function theyThemDeep<T>(value: T): { value: T; changed: boolean } {
  let changed = false;
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const out = theyThem(v);
      if (out !== v) changed = true;
      return out;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) out[k] = walk(x);
      return out;
    }
    return v;
  };
  const out = walk(value) as T;
  return { value: changed ? out : value, changed };
}
