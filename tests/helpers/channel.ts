import type { GameSession } from '../../src/server/session.js';
import type { ChatMessage } from '../../src/model/calls.js';
import type { Concession } from '../../src/domain/diplomacy.js';

/** The session's open channel, as a test reaches into it — see `OpenChannel` in `session.ts`. */
export interface TestChannel {
  with: string;
  history: ChatMessage[];
  concessions: Concession[];
  budget: { budget: number; given: number; over: string[] };
  blockers: { concession: string; principle: string }[];
}

/** Force a channel open without a model call, and hand it back to fill. */
export function openTestChannel(session: GameSession, factionId: string): TestChannel {
  const channel: TestChannel = { with: factionId, history: [], concessions: [], budget: { budget: 0, given: 0, over: [] }, blockers: [] };
  (session as unknown as { channel: TestChannel }).channel = channel;
  return channel;
}
