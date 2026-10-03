import {
  ActionRequestSchema,
  CheatRequestSchema,
  DiscardRequestSchema,
  ImportRequestSchema,
  NewCampaignRequestSchema,
  ResumeRequestSchema,
  ROUTES,
  SettingsUpdateSchema,
  TalkRequestSchema,
} from '../api/contract.js';
import type { KeyCheck } from '../model/provider.js';
import type { KeyedProvider } from '../model/settings.js';
import { ApiFailure, parseBody, toApiFailure } from './errors.js';
import type { GameSession } from './session.js';
import { applySettingsUpdate, settingsView, type StatusOf } from './settings.js';

/** What the settings routes reach outside the process for — injectable, so the suite reaches nothing. */
export interface SettingsDeps {
  statusOf?: StatusOf;
  checkKey?: (provider: KeyedProvider, key: string) => Promise<KeyCheck>;
}

/**
 * Route dispatch as a pure-ish function: (method, path, body) -> result.
 *
 * Kept free of `req`/`res` so the entire API surface can be exercised in tests
 * without binding a port or mocking node:http.
 */

export interface RouteResult {
  status: number;
  body: unknown;
  /**
   * A binary payload to send instead of JSON. Kept on the result rather than
   * written to a `res` so the export route stays as testable as every other
   * route — a test can assert on the bytes without binding a port.
   */
  download?: { filename: string; bytes: Uint8Array };
}

const ok = (body: unknown): RouteResult => ({ status: 200, body });

export async function dispatch(
  session: GameSession,
  method: string,
  path: string,
  body: unknown,
  deps: SettingsDeps = {},
): Promise<RouteResult> {
  try {
    return await route(session, method, path, body, deps);
  } catch (err) {
    const failure = toApiFailure(err);
    return { status: failure.status, body: failure.toBody() };
  }
}

async function route(
  session: GameSession,
  method: string,
  path: string,
  body: unknown,
  deps: SettingsDeps,
): Promise<RouteResult> {
  // Answerable with no campaign loaded: the settings screen is the first thing
  // a new player sees, before there is anything to play.
  if (method === 'GET' && path === ROUTES.settings) {
    return ok(settingsView(null, deps.statusOf));
  }
  if (method === 'POST' && path === ROUTES.settings) {
    return ok(await applySettingsUpdate(parseBody(SettingsUpdateSchema, body), deps.statusOf, deps.checkKey));
  }

  if (method === 'GET' && path === ROUTES.factions) {
    return ok(await session.factions());
  }

  // Reads arrive as POST too: on the stateless transport every request carries
  // the session in its body, and a GET has none.
  const read = method === 'GET' || method === 'POST';

  if (read && path === ROUTES.campaign) {
    if (!session.hasCampaign()) {
      throw new ApiFailure('no_campaign', 'No campaign is loaded. Start or resume one first.');
    }
    return ok(session.view());
  }

  if (method === 'POST' && path === ROUTES.newCampaign) {
    const { factionId, name, maxTurns, sandboxEvent } = parseBody(NewCampaignRequestSchema, body);
    return ok(await session.newCampaign(factionId, name, maxTurns, sandboxEvent));
  }

  if (read && path === ROUTES.exportCampaign) {
    const { filename, bytes } = session.exportArchive();
    return { status: 200, body: null, download: { filename, bytes } };
  }

  if (method === 'POST' && path === ROUTES.importCampaign) {
    const { archiveBase64, name } = parseBody(ImportRequestSchema, body);
    return ok(await session.importArchive(archiveBase64, name));
  }

  if (method === 'POST' && path === ROUTES.resume) {
    const { name } = parseBody(ResumeRequestSchema, body);
    return ok(await session.resume(name));
  }

  if (method === 'POST' && path === ROUTES.action) {
    const { text } = parseBody(ActionRequestSchema, body);
    return ok(await session.action(text));
  }

  if (method === 'POST' && path === ROUTES.advisor) {
    return ok(await session.advisor());
  }

  if (method === 'POST' && path === ROUTES.endturn) {
    return ok(await session.endTurn());
  }

  if (method === 'POST' && path === ROUTES.cheat) {
    return ok(await session.cheat(parseBody(CheatRequestSchema, body)));
  }

  if (method === 'POST' && path === ROUTES.discardStaged) {
    const { index } = parseBody(DiscardRequestSchema, body);
    return ok(await session.discardStaged(index));
  }

  const talk = matchFaction(path, '/api/talk/');
  if (method === 'POST' && talk) {
    const { text } = parseBody(TalkRequestSchema, body);
    return ok(await session.talk(talk, text));
  }

  const endtalk = matchFaction(path, '/api/endtalk/');
  if (method === 'POST' && endtalk) {
    return ok(await session.endTalk(endtalk));
  }

  throw new ApiFailure('not_found', `No route for ${method} ${path}.`);
}

/** Extract a faction id from a prefixed path, rejecting anything path-like. */
function matchFaction(path: string, prefix: string): string | null {
  if (!path.startsWith(prefix)) return null;
  const id = decodeURIComponent(path.slice(prefix.length));
  return /^[\w-]+$/.test(id) ? id : null;
}
