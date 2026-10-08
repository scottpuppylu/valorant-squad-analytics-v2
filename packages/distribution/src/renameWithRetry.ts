import { rename } from 'node:fs/promises';

/**
 * Ported verbatim (PURE_REUSABLE) from legacy `server/staticExport/renameWithRetry.ts` at release 1a4c790.
 *
 * Atomic rename with a BOUNDED retry for transient Windows locks (an indexer / antivirus briefly holding a handle
 * on a just-written directory yields EPERM / EACCES / EBUSY). Any other error, or exhausting the budget, throws.
 */
const transient = new Set(['EPERM', 'EACCES', 'EBUSY']);

export async function renameWithRetry(from: string, to: string, options: { attempts?: number; delayMs?: number; rename?: typeof rename } = {}) {
  const attempts = options.attempts ?? 10;
  const delayMs = options.delayMs ?? 150;
  const doRename = options.rename ?? rename;
  for (let attempt = 1; ; attempt += 1) {
    try {
      await doRename(from, to);
      return attempt;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!code || !transient.has(code) || attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
}
