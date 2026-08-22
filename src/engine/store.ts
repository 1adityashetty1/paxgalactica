import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/**
 * Campaign persistence, behind an interface.
 *
 * The engine used to call `node:fs` directly, which tied it to a process with a
 * filesystem and a fixed layout. A server wants the same engine with different
 * storage (and tests want none at all), so persistence is now injected.
 *
 * Deliberately async throughout. A synchronous variant existed only for the Ink
 * TUI, which is being retired; carrying a sync/async duality forever to serve a
 * frontend that is about to be deleted would be permanent complexity bought for
 * nothing.
 */

const ChatMessageSchema = z.object({
  speaker: z.enum(['player', 'faction']),
  text: z.string(),
});

export const SaveFileSchema = z.object({
  version: z.literal(1),
  journal: z.object({
    // Every version loads, and each replays under the rule that was in force
    // when it was written — see `replay`. v1 predates `form_treaty` requiring
    // the `extraction` source; v1 and v2 both predate batches being atomic, and
    // recorded batches that really did apply in part.
    version: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    entries: z.array(z.unknown()),
  }),
  /**
   * Diplomatic transcripts, per faction. Kept beside the journal rather than
   * inside world state: they are conversation history, not world facts, and
   * only the extraction pass turns them into ops.
   */
  transcripts: z.record(z.string(), z.array(z.array(ChatMessageSchema))),
});
export type SaveFile = z.infer<typeof SaveFileSchema>;

export interface CampaignStore {
  load(name: string): Promise<SaveFile | null>;
  save(name: string, data: SaveFile): Promise<void>;
  list(): Promise<string[]>;
  exists(name: string): Promise<boolean>;
}

const HERE = dirname(fileURLToPath(import.meta.url));
export const SAVE_DIR = join(HERE, '..', '..', 'saves');

/** Saves to `saves/<name>.json`, the layout campaigns already use on disk. */
export class FileCampaignStore implements CampaignStore {
  constructor(private readonly dir: string = SAVE_DIR) {}

  private path(name: string): string {
    // Guard against a name escaping the save directory. Nothing untrusted
    // reaches this today, but a server route is one step away from doing so.
    if (!/^[\w.-]+$/.test(name)) {
      throw new Error(`Invalid campaign name "${name}". Use letters, digits, dot, dash, underscore.`);
    }
    return join(this.dir, `${name}.json`);
  }

  async load(name: string): Promise<SaveFile | null> {
    try {
      const raw = await readFile(this.path(name), 'utf8');
      return SaveFileSchema.parse(JSON.parse(raw));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async save(name: string, data: SaveFile): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.path(name), JSON.stringify(data, null, 2), 'utf8');
  }

  async list(): Promise<string[]> {
    try {
      const files = await readdir(this.dir);
      return files.filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
    } catch {
      return [];
    }
  }

  async exists(name: string): Promise<boolean> {
    return existsSync(this.path(name));
  }
}

/** In-memory store, so tests never touch the disk. */
export class MemoryCampaignStore implements CampaignStore {
  private readonly saves = new Map<string, SaveFile>();

  async load(name: string): Promise<SaveFile | null> {
    const found = this.saves.get(name);
    // Round-trip through JSON so callers cannot mutate stored state by
    // holding on to the object they saved — the same hazard a real file
    // does not have.
    return found ? (JSON.parse(JSON.stringify(found)) as SaveFile) : null;
  }

  async save(name: string, data: SaveFile): Promise<void> {
    this.saves.set(name, JSON.parse(JSON.stringify(data)) as SaveFile);
  }

  async list(): Promise<string[]> {
    return [...this.saves.keys()].sort();
  }

  async exists(name: string): Promise<boolean> {
    return this.saves.has(name);
  }
}
