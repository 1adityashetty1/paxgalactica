/**
 * The model layer's errors, in their own module so every provider and the
 * client above them can share them without importing each other.
 */

export class ModelCallError extends Error {
  constructor(
    message: string,
    readonly attempts: number,
    readonly lastRaw?: unknown,
  ) {
    super(message);
    this.name = 'ModelCallError';
  }
}

const SUBSCRIPTION_SIGN_IN = [
  'Claude Code is not signed in, so no model calls can be made.',
  '',
  'Quit with :quit, then run these in the project directory:',
  '',
  '    pnpm login     sign in with your Claude Pro/Max subscription',
  '    pnpm auth      confirm it worked',
  '',
  'Then `pnpm play:web` again. Nothing you have declared this turn was lost from',
  'the save — only the model call failed.',
].join('\n');

/**
 * The provider has no usable credential. Fatal on the first attempt: retrying
 * cannot help.
 *
 * The message is the provider's own. The subscription's names `pnpm login`; a
 * keyed provider's names the settings screen, because a packaged build has no
 * package manager to tell anybody to run (docs/architecture.md A.8).
 */
export class NotLoggedInError extends ModelCallError {
  constructor(message: string = SUBSCRIPTION_SIGN_IN) {
    super(message, 0);
    this.name = 'NotLoggedInError';
  }
}

/**
 * The spend cap is reached. Fatal, and deliberately not retried: the whole
 * point is that nothing more is spent until the player raises it.
 */
export class SpendCapError extends ModelCallError {
  constructor(
    readonly spentUsd: number,
    readonly capUsd: number,
  ) {
    super(
      `This session has spent $${spentUsd.toFixed(2)} on model calls, which reaches the spend cap of $${capUsd.toFixed(2)}. Nothing more will be spent until the cap is raised in Settings.`,
      0,
    );
    this.name = 'SpendCapError';
  }
}
