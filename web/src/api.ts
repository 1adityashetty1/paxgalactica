import {
  ActionOutcomeSchema,
  ApiErrorSchema,
  CampaignViewSchema,
  FactionListSchema,
  ImportOutcomeSchema,
  ROUTES,
  TurnOutcomeSchema,
  type ActionOutcomeResponse,
  type CampaignView,
  type TurnOutcomeResponse,
} from '../../src/api/contract.js';

/**
 * Typed client for the game server.
 *
 * Responses are parsed with the same Zod schemas the server validates against,
 * so a contract drift shows up here as a loud error instead of an undefined
 * field three components deep.
 */

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** A call is already running. Expected, not exceptional. */
  get isBusy(): boolean {
    return this.code === 'conflict';
  }

  /** No campaign loaded — the signal to show the picker. */
  get isNoCampaign(): boolean {
    return this.code === 'no_campaign';
  }

  get isAuth(): boolean {
    return this.code === 'not_authenticated';
  }
}

async function request<T>(
  path: string,
  schema: { parse: (v: unknown) => T },
  init?: RequestInit,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError('internal', 'Cannot reach the game server. Is it still running?', 0);
  }

  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError('internal', `Server returned non-JSON (HTTP ${res.status}).`, res.status);
  }

  if (!res.ok) {
    const parsed = ApiErrorSchema.safeParse(body);
    if (parsed.success) {
      throw new ApiError(parsed.data.error.code, parsed.data.error.message, res.status);
    }
    throw new ApiError('internal', `HTTP ${res.status}`, res.status);
  }

  return schema.parse(body);
}

const post = (body?: unknown): RequestInit => ({
  method: 'POST',
  body: JSON.stringify(body ?? {}),
});

export const api = {
  factions: () => request(ROUTES.factions, FactionListSchema),

  campaign: () => request(ROUTES.campaign, CampaignViewSchema),

  newCampaign: (factionId: string, name = 'campaign'): Promise<CampaignView> =>
    request(ROUTES.newCampaign, CampaignViewSchema, post({ factionId, name })),

  resume: (name: string): Promise<CampaignView> =>
    request(ROUTES.resume, CampaignViewSchema, post({ name })),

  action: (text: string): Promise<ActionOutcomeResponse> =>
    request(ROUTES.action, ActionOutcomeSchema, post({ text })),

  endTurn: (): Promise<TurnOutcomeResponse> =>
    request(ROUTES.endturn, TurnOutcomeSchema, post()),

  discardStaged: (index?: number) =>
    request(
      ROUTES.discardStaged,
      { parse: (v: unknown) => v as { discarded: number } },
      post(index === undefined ? {} : { index }),
    ),

  talk: (factionId: string, text: string) =>
    request(
      ROUTES.talk(factionId),
      { parse: (v: unknown) => v as { reply: string; costUsd: number } },
      post({ text }),
    ),

  endTalk: (factionId: string): Promise<ActionOutcomeResponse> =>
    request(ROUTES.endtalk(factionId), ActionOutcomeSchema, post()),

  /**
   * Download the campaign as a .tar.gz.
   *
   * Deliberately NOT a link the browser follows on its own: this way an error
   * from the server arrives as a normal ApiError in the UI, instead of the
   * browser navigating away and rendering a JSON error page over the game.
   */
  async exportCampaign(): Promise<{ filename: string; size: number }> {
    const res = await fetch(ROUTES.exportCampaign);
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as unknown;
      const parsed = ApiErrorSchema.safeParse(body);
      throw new ApiError(
        parsed.success ? parsed.data.error.code : 'internal',
        parsed.success ? parsed.data.error.message : `HTTP ${res.status}`,
        res.status,
      );
    }

    const blob = await res.blob();
    const filename =
      /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ??
      'campaign.tar.gz';

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    // Revoking immediately can cancel the download in some browsers; one tick
    // is enough for the click to have been handed off.
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    return { filename, size: blob.size };
  },

  async importCampaign(file: File, name?: string) {
    const archiveBase64 = await toBase64(file);
    return request(ROUTES.importCampaign, ImportOutcomeSchema, post({ archiveBase64, name }));
  },
};

/** FileReader gives a data: URL; the payload is everything after the comma. */
function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(',');
      if (comma === -1) reject(new Error('Unexpected file encoding.'));
      else resolve(result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}
