const lastRefreshAt = new Map<string, number>();

export function assertRefreshInterval(key: string, minIntervalMs: number) {
  const now = Date.now();
  const previous = lastRefreshAt.get(key) ?? 0;

  if (minIntervalMs > 0 && now - previous < minIntervalMs) {
    return false;
  }

  lastRefreshAt.set(key, now);
  return true;
}

export function resetRefreshThrottleForTests() {
  lastRefreshAt.clear();
}
