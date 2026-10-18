import { orderFor } from '../src/domain/ops.js';

/**
 * A batch read as the orders it means: work (`move`, `raid`, `fortify`, …) as
 * the `issue_order` it is filed under, and every other op as it is. Tests that
 * look for a bot's raid or attack by its order type read the bot's work through
 * the same conversion the reducer uses (`orderFor`).
 */
export const asOrders = (ops: readonly unknown[]): Record<string, unknown>[] =>
  ops.map((o) => (orderFor(o) ?? o) as Record<string, unknown>);
