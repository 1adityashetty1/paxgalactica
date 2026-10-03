import { z } from 'zod';

/**
 * The provider ids, alone in a module with no I/O, because the browser needs
 * them too: the contract imports this, and the contract is bundled into the
 * client — where `settings.ts`, which reads files, must never go.
 */
export const PROVIDER_IDS = ['subscription', 'anthropic', 'openrouter'] as const;
export const ProviderIdSchema = z.enum(PROVIDER_IDS);
export type ProviderId = z.infer<typeof ProviderIdSchema>;

/** The providers that take a pasted key. The subscription takes `pnpm login`. */
export const KEYED_PROVIDERS = ['anthropic', 'openrouter'] as const;
export type KeyedProvider = (typeof KEYED_PROVIDERS)[number];
