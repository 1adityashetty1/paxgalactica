import { gunzipSync, gzipSync } from 'node:zlib';
import { z } from 'zod';
import { replay, type Journal } from './journal.js';
import { SaveFileSchema, type SaveFile } from './store.js';
import { readTar, writeTar } from './tar.js';

/**
 * Campaign archives: one `.tar.gz` holding everything needed to resume a game
 * somewhere else.
 *
 * The archive is a *transport* format, not a second source of truth. Inside it
 * is the same save file the game already writes, plus a manifest describing it
 * and a README telling a human what to do with it. The journal remains the only
 * thing that defines the campaign — which is what makes an archive verifiable:
 * unpacking replays it from turn 0 and checks the world it produces.
 *
 * Why tar.gz rather than the bare JSON save: a save is only meaningful together
 * with its transcripts and the format version that reads it, and a single
 * self-describing file is what someone can actually email to themselves. The
 * gzip layer matters more than it looks — journals are extremely repetitive and
 * compress by roughly 10×.
 */

export const ARCHIVE_VERSION = 1;
const PREFIX = 'paxgalactica';

export const ManifestSchema = z.object({
  format: z.literal('paxgalactica-campaign'),
  archiveVersion: z.literal(ARCHIVE_VERSION),
  name: z.string(),
  playerFactionId: z.string(),
  turn: z.number().int().min(0),
  journalEntries: z.number().int().min(0),
  exportedAt: z.string(),
});
export type Manifest = z.infer<typeof ManifestSchema>;

export interface UnpackedCampaign {
  manifest: Manifest;
  save: SaveFile;
  /** Turn reached by replaying the journal — proof the archive is playable. */
  turn: number;
  /** Ops the reducer refused during verification. Non-zero is not fatal; the journal records rejections faithfully. */
  rejectionCount: number;
}

const README = `Pax Galactica campaign archive
==============================

This file holds one saved campaign: its complete ops journal and its
diplomatic transcripts. The journal is the campaign — the world is rebuilt
from it by replaying every op through the same pure reducer that produced
them, so this archive is the whole game and not a snapshot of one.

To resume it:

    pnpm resume <this-file>

That verifies the archive by replaying it, installs it into saves/, and
starts the server with the campaign loaded.

To inspect it without the game:

    tar -xzf <this-file>
    cat ${PREFIX}/manifest.json
`;

const encode = (value: unknown): Uint8Array =>
  new Uint8Array(Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8'));

/** Build the downloadable archive for a campaign. */
export function packCampaign(
  name: string,
  save: SaveFile,
  options: { now?: number } = {},
): Uint8Array {
  const now = options.now ?? Date.now();
  const entries = save.journal.entries as Journal['entries'];
  const seed = entries[0];

  const manifest: Manifest = ManifestSchema.parse({
    format: 'paxgalactica-campaign',
    archiveVersion: ARCHIVE_VERSION,
    name,
    playerFactionId:
      seed && typeof seed === 'object' && 'playerFactionId' in seed
        ? String((seed as { playerFactionId: unknown }).playerFactionId)
        : 'unknown',
    // Ticks are what advance time, so counting them gives the turn without
    // replaying the whole journal just to write a manifest.
    turn: entries.filter((e) => (e as { kind?: string }).kind === 'tick').length,
    journalEntries: entries.length,
    exportedAt: new Date(now).toISOString(),
  });

  return gzipSync(
    writeTar(
      [
        { path: `${PREFIX}/manifest.json`, bytes: encode(manifest) },
        { path: `${PREFIX}/campaign.json`, bytes: encode(save) },
        { path: `${PREFIX}/README.txt`, bytes: new Uint8Array(Buffer.from(README, 'utf8')) },
      ],
      now,
    ),
    // Level 9: these are small files written once and read rarely, so spending
    // the compression time is free in practice.
    { level: 9 },
  );
}

/** Suggested download filename — safe on every platform, and sorts by date. */
export function archiveFilename(name: string, now = Date.now()): string {
  const stamp = new Date(now).toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return `${name.replace(/[^\w.-]/g, '_')}-${stamp}.tar.gz`;
}

/**
 * Read an archive, validate it, and prove it is playable by replaying it.
 *
 * Every failure here is a plain `Error` with a message written for a human
 * holding a file they hope is a save — "not a gzip file", not a stack trace.
 */
export function unpackCampaign(data: Uint8Array): UnpackedCampaign {
  let tarBytes: Uint8Array;
  try {
    tarBytes = new Uint8Array(gunzipSync(Buffer.from(data)));
  } catch {
    throw new Error('That file is not gzip-compressed. Expected a .tar.gz campaign archive.');
  }

  const entries = readTar(tarBytes);
  const find = (leaf: string) =>
    entries.find((e) => e.path === leaf || e.path.endsWith(`/${leaf}`));

  const manifestEntry = find('manifest.json');
  const campaignEntry = find('campaign.json');
  if (!manifestEntry || !campaignEntry) {
    throw new Error(
      'That archive is not a Pax Galactica campaign: manifest.json or campaign.json is missing.',
    );
  }

  const manifest = parse(ManifestSchema, manifestEntry.bytes, 'manifest.json');
  if (manifest.archiveVersion !== ARCHIVE_VERSION) {
    throw new Error(
      `Archive version ${manifest.archiveVersion} was written by a different build of the game; this one reads version ${ARCHIVE_VERSION}.`,
    );
  }

  const save = parse(SaveFileSchema, campaignEntry.bytes, 'campaign.json');

  // The real integrity check. A journal that does not replay is not a
  // campaign, whatever the manifest claims — and finding that out here beats
  // finding it out after the server has adopted it.
  let verified: ReturnType<typeof replay>;
  try {
    verified = replay(save.journal as Journal);
  } catch (err) {
    throw new Error(
      `The archive's journal could not be replayed, so the campaign cannot be restored: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  return {
    manifest,
    save,
    turn: verified.state.turn,
    rejectionCount: verified.rejectionCount,
  };
}

function parse<T>(schema: z.ZodType<T>, bytes: Uint8Array, what: string): T {
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    throw new Error(`${what} inside the archive is not valid JSON.`);
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    throw new Error(`${what} inside the archive is malformed: ${result.error.issues[0]?.message}`);
  }
  return result.data;
}
