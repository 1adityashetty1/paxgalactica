/** A power's id or name as `tests/naming.test.ts` compares them: letters and digits, lower-case. */
export const flatten = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');
