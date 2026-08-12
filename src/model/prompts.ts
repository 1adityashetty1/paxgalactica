import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Prompts are versioned .md files under prompts/, never inline strings, so
 * that a prompt change shows up as a reviewable diff and can be replayed
 * against a recorded campaign.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
// dist/model/prompts.js -> ../../prompts, and src/model/prompts.ts -> ../../prompts
const PROMPT_DIR = join(HERE, '..', '..', 'prompts');

const cache = new Map<string, string>();

export type PromptName =
  | 'resolution'
  | 'reaction'
  | 'diplomacy-persona'
  | 'extraction'
  | 'appraisal'
  | 'correction'
  | 'duration-rubric'
  | 'flavor';

export function loadPrompt(name: PromptName): string {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;
  const path = join(PROMPT_DIR, `${name}.md`);
  try {
    const text = readFileSync(path, 'utf8');
    cache.set(name, text);
    return text;
  } catch {
    throw new Error(
      `Missing prompt file ${path}. Prompts are versioned on disk; restore it from git rather than inlining the text.`,
    );
  }
}

/** Test seam: force a reload after editing a prompt mid-session. */
export function clearPromptCache(): void {
  cache.clear();
}
