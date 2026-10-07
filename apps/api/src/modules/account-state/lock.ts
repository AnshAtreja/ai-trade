const tails = new Map<string, Promise<unknown>>();

/**
 * Process-local serialization for paper trade creation.
 * Combined with a PaperAccount row lock inside database transactions.
 * This is not distributed locking across multiple API processes.
 */
export function withUserLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  const next = previous.then(work, work);
  tails.set(
    key,
    next.then(
      () => undefined,
      () => undefined
    )
  );
  return next;
}
