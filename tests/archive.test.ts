import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import {
  archiveFilename,
  packCampaign,
  unpackCampaign,
  ARCHIVE_VERSION,
} from '../src/engine/archive.js';
import { readTar, writeTar } from '../src/engine/tar.js';
import { Campaign } from '../src/engine/campaign.js';
import { MemoryCampaignStore } from '../src/engine/store.js';
import { GameSession } from '../src/server/session.js';
import { dispatch } from '../src/server/router.js';
import { ROUTES } from '../src/api/contract.js';

/**
 * A campaign archive is the one artefact a player is invited to carry between
 * machines, so the standard it is held to is: whatever comes back out must
 * replay to the same world that went in, and anything that is not a real
 * archive must fail with a sentence a human can act on.
 */

const scratch = mkdtempSync(join(tmpdir(), 'paxgalactica-archive-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A campaign with some history in it, so the round trip has something to lose. */
function played(name = 'archived') {
  const campaign = Campaign.start('freeworlds', name, new MemoryCampaignStore());
  campaign.commit(
    [
      {
        op: 'issue_order', factionId: 'freeworlds', type: 'construction_infrastructure',
        originId: 'ark-1', targetId: 'ark-1', durationTurns: 5, label: 'shipyard',
      },
    ],
    'model',
    'build',
  );
  campaign.tick();
  campaign.commit(
    [{ op: 'adjust_disposition', factionId: 'freeworlds', towardFactionId: 'hutt', delta: 12 }],
    'model',
    'talks',
  );
  campaign.tick();
  campaign.recordTranscript('hutt', [
    { speaker: 'player', text: 'Name your price.' },
    { speaker: 'faction', text: 'Higher than that.' },
  ]);
  return campaign;
}

describe('tar, by hand', () => {
  it('round-trips files byte for byte', () => {
    const entries = [
      { path: 'a/one.json', bytes: new Uint8Array(Buffer.from('{"x":1}')) },
      { path: 'a/two.txt', bytes: new Uint8Array(Buffer.from('hello')) },
    ];
    const back = readTar(writeTar(entries, 0));
    expect(back.map((e) => e.path)).toEqual(['a/one.json', 'a/two.txt']);
    expect(Buffer.from(back[0]!.bytes).toString()).toBe('{"x":1}');
    expect(Buffer.from(back[1]!.bytes).toString()).toBe('hello');
  });

  it('pads every entry to a 512-byte boundary and ends with two zero blocks', () => {
    const tar = writeTar([{ path: 'x', bytes: new Uint8Array(Buffer.from('abc')) }], 0);
    expect(tar.length % 512).toBe(0);
    expect(tar.length).toBe(512 * 4); // header + padded body + two end blocks
    expect(tar.slice(512 * 2).every((b) => b === 0)).toBe(true);
  });

  it('survives content that is exactly one block long', () => {
    // The off-by-one that hand-rolled tar writers get wrong: no padding is
    // needed, and adding a full empty block instead would desynchronise reads.
    const bytes = new Uint8Array(Buffer.alloc(512, 0x41));
    const back = readTar(writeTar([{ path: 'exact', bytes }], 0));
    expect(back[0]!.bytes.length).toBe(512);
  });

  it('handles an empty file', () => {
    const back = readTar(writeTar([{ path: 'empty', bytes: new Uint8Array() }], 0));
    expect(back).toHaveLength(1);
    expect(back[0]!.bytes.length).toBe(0);
  });

  it('writes a checksum a real tar would accept', () => {
    const tar = writeTar([{ path: 'x', bytes: new Uint8Array(Buffer.from('abc')) }], 0);
    const header = Buffer.from(tar.subarray(0, 512));
    const claimed = Number.parseInt(header.toString('ascii', 148, 154), 8);
    // Recompute with the checksum field blanked, which is how the format
    // defines it.
    const scratchBuf = Buffer.from(header);
    scratchBuf.write('        ', 148, 8, 'ascii');
    let sum = 0;
    for (const byte of scratchBuf) sum += byte;
    expect(claimed).toBe(sum);
    expect(header.toString('ascii', 257, 262)).toBe('ustar');
  });

  it('refuses a truncated archive rather than returning half a file', () => {
    const tar = writeTar([{ path: 'x', bytes: new Uint8Array(Buffer.from('abc')) }], 0);
    expect(() => readTar(tar.slice(0, 900))).toThrow(/512-byte blocks/);
  });

  it('refuses something that is not a tar at all', () => {
    expect(() => readTar(new Uint8Array(Buffer.alloc(1024, 0x7a)))).toThrow(/Not a tar/);
  });

  it('rejects a path that climbs out of the archive', () => {
    const tar = Buffer.from(writeTar([{ path: 'safe', bytes: new Uint8Array(1) }], 0));
    tar.fill(0, 0, 100);
    tar.write('../../etc/passwd', 0, 100, 'utf8');
    // The header checksum is now wrong too, but the traversal guard is what
    // must fire — a reader that validates paths only after extracting is a
    // reader that has already written the file.
    expect(() => readTar(new Uint8Array(tar))).toThrow(/Unsafe path/);
  });

  it('refuses a path too long for the format instead of truncating it', () => {
    expect(() => writeTar([{ path: 'x'.repeat(101), bytes: new Uint8Array(1) }])).toThrow(
      /too long/,
    );
  });
});

describe('a campaign archive round-trips', () => {
  it('comes back as the same world it went in as', () => {
    const campaign = played();
    const before = JSON.stringify(campaign.state);

    const restored = unpackCampaign(packCampaign('archived', campaign.toSaveFile()));
    const reloaded = Campaign.fromSaveFile('archived', restored.save, new MemoryCampaignStore());

    expect(JSON.stringify(reloaded.state)).toBe(before);
    expect(reloaded.verifyReplay().ok).toBe(true);
  });

  it('carries diplomatic transcripts, which live outside the journal', () => {
    const restored = unpackCampaign(packCampaign('archived', played().toSaveFile()));
    const reloaded = Campaign.fromSaveFile('archived', restored.save, new MemoryCampaignStore());
    expect(reloaded.priorTranscripts('hutt')[0]).toMatch(/Name your price/);
  });

  it('describes itself in a manifest without needing the game to read it', () => {
    const bytes = packCampaign('mycamp', played().toSaveFile(), { now: 1_700_000_000_000 });
    const entries = readTar(gunzipSync(Buffer.from(bytes)));
    const manifest = JSON.parse(
      Buffer.from(entries.find((e) => e.path.endsWith('manifest.json'))!.bytes).toString(),
    );
    expect(manifest).toMatchObject({
      format: 'paxgalactica-campaign',
      archiveVersion: ARCHIVE_VERSION,
      name: 'mycamp',
      playerFactionId: 'freeworlds',
      turn: 2,
    });
    expect(manifest.exportedAt).toBe('2023-11-14T22:13:20.000Z');
  });

  it('ships a README, so the file explains itself without the game', () => {
    const entries = readTar(gunzipSync(Buffer.from(packCampaign('c', played().toSaveFile()))));
    const readme = entries.find((e) => e.path.endsWith('README.txt'));
    expect(Buffer.from(readme!.bytes).toString()).toMatch(/pnpm resume/);
  });

  it('compresses hard on a journal of real length', () => {
    // On a two-turn campaign the fixed README outweighs the save, so the
    // claim is only meaningful at the scale it is made for: journals are
    // extremely repetitive and a long one should shrink several times over.
    const long = played('long');
    for (let i = 0; i < 40; i++) {
      long.commit(
        [{ op: 'adjust_disposition', factionId: 'freeworlds', towardFactionId: 'krayt', delta: 1 }],
        'model',
        `turn ${i}`,
      );
      long.tick();
    }
    const save = long.toSaveFile();
    const packed = packCampaign('long', save);
    expect(packed.length).toBeLessThan(JSON.stringify(save).length / 4);
  });

  it('reports the turn it verified by replaying, not the one it was told', () => {
    const restored = unpackCampaign(packCampaign('c', played().toSaveFile()));
    expect(restored.turn).toBe(2);
    expect(restored.rejectionCount).toBe(0);
  });

  it('names the download so it sorts by date and is safe on any filesystem', () => {
    const name = archiveFilename('my campaign/../etc', 1_700_000_000_000);
    expect(name).toBe('my_campaign_.._etc-2023-11-14-22-13.tar.gz');
    expect(name).not.toContain('/');
  });
});

describe('a bad archive fails with something a human can act on', () => {
  const message = (bytes: Uint8Array) => {
    try {
      unpackCampaign(bytes);
      return 'no error';
    } catch (err) {
      return (err as Error).message;
    }
  };

  it('rejects a file that is not gzipped', () => {
    expect(message(new Uint8Array(Buffer.from('just some text')))).toMatch(/not gzip/i);
  });

  it('rejects a gzip that is not a Pax Galactica archive', () => {
    const other = gzipSync(writeTar([{ path: 'notes.txt', bytes: new Uint8Array(3) }], 0));
    expect(message(new Uint8Array(other))).toMatch(/not a Pax Galactica campaign/i);
  });

  it('rejects an archive whose journal does not replay', () => {
    const broken = gzipSync(
      writeTar(
        [
          {
            path: 'p/manifest.json',
            bytes: new Uint8Array(
              Buffer.from(
                JSON.stringify({
                  format: 'paxgalactica-campaign',
                  archiveVersion: ARCHIVE_VERSION,
                  name: 'broken',
                  playerFactionId: 'freeworlds',
                  turn: 0,
                  journalEntries: 1,
                  exportedAt: new Date(0).toISOString(),
                }),
              ),
            ),
          },
          {
            path: 'p/campaign.json',
            bytes: new Uint8Array(
              Buffer.from(
                // A journal that does not begin with a seed is not a campaign.
                JSON.stringify({
                  version: 1,
                  journal: { version: 1, entries: [{ kind: 'tick' }] },
                  transcripts: {},
                }),
              ),
            ),
          },
        ],
        0,
      ),
    );
    expect(message(new Uint8Array(broken))).toMatch(/could not be replayed/i);
  });

  it('refuses an archive from a future format rather than guessing', () => {
    const future = gzipSync(
      writeTar(
        [
          {
            path: 'p/manifest.json',
            bytes: new Uint8Array(
              Buffer.from(JSON.stringify({ format: 'paxgalactica-campaign', archiveVersion: 99 })),
            ),
          },
          { path: 'p/campaign.json', bytes: new Uint8Array(Buffer.from('{}')) },
        ],
        0,
      ),
    );
    // The literal in the schema catches it first; either way the file is
    // refused rather than half-read.
    expect(message(new Uint8Array(future))).toMatch(/malformed|different build/i);
  });
});

describe('the export and import routes', () => {
  const session = async (name = 'served') => {
    const store = new MemoryCampaignStore();
    const s = new GameSession(store);
    await s.newCampaign('freeworlds', name);
    return s;
  };

  it('serves a downloadable archive with a filename', async () => {
    const s = await session();
    const res = await dispatch(s, 'GET', ROUTES.exportCampaign, {});
    expect(res.status).toBe(200);
    expect(res.download!.filename).toMatch(/^served-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.tar\.gz$/);
    expect(unpackCampaign(res.download!.bytes).manifest.name).toBe('served');
  });

  it('refuses to export when no campaign is loaded', async () => {
    const res = await dispatch(new GameSession(new MemoryCampaignStore()), 'GET', ROUTES.exportCampaign, {});
    expect((res.body as { error: { code: string } }).error.code).toBe('no_campaign');
    expect(res.download).toBeUndefined();
  });

  it('imports what it exported, into a different process entirely', async () => {
    const source = await session('origin');
    const exported = (await dispatch(source, 'GET', ROUTES.exportCampaign, {})).download!.bytes;

    // A brand-new session with an empty store: nothing is shared but the bytes.
    const target = new GameSession(new MemoryCampaignStore());
    expect(target.hasCampaign()).toBe(false);

    const res = await dispatch(target, 'POST', ROUTES.importCampaign, {
      archiveBase64: Buffer.from(exported).toString('base64'),
    });
    expect(res.status).toBe(200);
    expect(target.hasCampaign()).toBe(true);
    expect(target.view().name).toBe('origin');
  });

  it('can rename on import, so two archives do not collide', async () => {
    const source = await session('origin');
    const exported = (await dispatch(source, 'GET', ROUTES.exportCampaign, {})).download!.bytes;
    const store = new MemoryCampaignStore();
    const target = new GameSession(store);
    await dispatch(target, 'POST', ROUTES.importCampaign, {
      archiveBase64: Buffer.from(exported).toString('base64'),
      name: 'copy',
    });
    expect(target.view().name).toBe('copy');
    expect(await store.list()).toEqual(['copy']);
  });

  it('leaves the session untouched when the archive is rubbish', async () => {
    const s = await session('keepme');
    const res = await dispatch(s, 'POST', ROUTES.importCampaign, {
      archiveBase64: Buffer.from('not an archive').toString('base64'),
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: { message: string } }).error.message).toMatch(/not gzip/i);
    // The campaign that was already open is still the one that is open.
    expect(s.view().name).toBe('keepme');
  });

  it('rejects an empty upload', async () => {
    const s = await session();
    const res = await dispatch(s, 'POST', ROUTES.importCampaign, { archiveBase64: 'x' });
    expect(res.status).toBe(400);
  });

  it('excludes staged actions, and says how many were left behind', async () => {
    const s = await session('staging');
    // Reach past the API to stage without a model call.
    const campaign = (s as unknown as { campaign: Campaign }).campaign;
    campaign.stage([{ op: 'adjust_credits', factionId: 'freeworlds', delta: -100 }], 'spend');

    const { bytes, stagedLost } = s.exportArchive();
    expect(stagedLost).toBe(1);
    const restored = Campaign.fromSaveFile(
      'x',
      unpackCampaign(bytes).save,
      new MemoryCampaignStore(),
    );
    // The archive holds committed truth, not the preview.
    expect(restored.state.factions.find((f) => f.id === 'freeworlds')!.credits).toBe(1100);
  });
});

describe('the resume CLI', () => {
  const cli = (args: string[]) => {
    try {
      return {
        code: 0,
        out: execFileSync(process.execPath, [join('dist', 'resume.js'), ...args], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        }),
      };
    } catch (err) {
      const e = err as { status: number; stdout: string; stderr: string };
      return { code: e.status, out: `${e.stdout}${e.stderr}` };
    }
  };

  it('verifies and reports an archive without writing anything', () => {
    const file = join(scratch, 'campaign.tar.gz');
    writeFileSync(file, packCampaign('fromcli', played().toSaveFile()));

    const { code, out } = cli([file, '--inspect']);
    expect(code, out).toBe(0);
    expect(out).toMatch(/campaign\s+fromcli/);
    expect(out).toMatch(/turn\s+2/);
    expect(out).toMatch(/replayed clean/);
    expect(out).toMatch(/Arkanis Free Worlds/);
    expect(out).toMatch(/1 conversations/);
    expect(out).not.toMatch(/Installed/);
  });

  it('explains itself when run with no file', () => {
    const { code, out } = cli([]);
    expect(code).toBe(1);
    expect(out).toMatch(/pnpm resume <archive\.tar\.gz>/);
  });

  it('fails clearly on a file that is not an archive', () => {
    const file = join(scratch, 'junk.tar.gz');
    writeFileSync(file, 'definitely not gzip');
    const { code, out } = cli([file, '--inspect']);
    expect(code).toBe(1);
    expect(out).toMatch(/not gzip-compressed/);
  });

  it('fails clearly on a file that is not there', () => {
    const { code, out } = cli([join(scratch, 'nope.tar.gz'), '--inspect']);
    expect(code).toBe(1);
    expect(out).toMatch(/Could not read/);
  });

  it('installs into a save store and stops when told not to serve', () => {
    const file = join(scratch, 'install.tar.gz');
    writeFileSync(file, packCampaign('installed_test', played().toSaveFile()));
    const { code, out } = cli([file, '--as', 'cli_installed', '--no-serve']);
    expect(code, out).toBe(0);
    expect(out).toMatch(/Installed .*cli_installed\.json/);

    const saved = JSON.parse(
      readFileSync(/Installed (.*\.json)/.exec(out)![1]!, 'utf8'),
    ) as { journal: { entries: unknown[] } };
    expect(saved.journal.entries.length).toBeGreaterThan(1);
    rmSync(/Installed (.*\.json)/.exec(out)![1]!, { force: true });
  });
});
