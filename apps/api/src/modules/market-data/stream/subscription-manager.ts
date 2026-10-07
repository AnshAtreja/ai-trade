import type { MarketStreamMode, SubscriptionRecord } from "./types";

export interface SubscriptionDiff {
  subscribe: SubscriptionRecord[];
  unsubscribe: string[];
  setMode: SubscriptionRecord[];
}

export class SubscriptionManager {
  private readonly desired = new Map<string, MarketStreamMode>();
  private readonly actual = new Map<string, MarketStreamMode>();

  getDesired(): SubscriptionRecord[] {
    return [...this.desired.entries()].map(([instrumentToken, mode]) => ({ instrumentToken, mode }));
  }

  getActual(): SubscriptionRecord[] {
    return [...this.actual.entries()].map(([instrumentToken, mode]) => ({ instrumentToken, mode }));
  }

  size() {
    return this.desired.size;
  }

  subscribe(instrumentTokens: string[], mode: MarketStreamMode = "LTP") {
    for (const token of uniqueTokens(instrumentTokens)) {
      this.desired.set(token, mode);
    }

    return this.diff();
  }

  unsubscribe(instrumentTokens: string[]) {
    for (const token of uniqueTokens(instrumentTokens)) {
      this.desired.delete(token);
    }

    return this.diff();
  }

  markActual(instrumentTokens: string[], mode: MarketStreamMode) {
    for (const token of uniqueTokens(instrumentTokens)) {
      this.actual.set(token, mode);
    }
  }

  clearActual() {
    this.actual.clear();
  }

  removeActual(instrumentTokens: string[]) {
    for (const token of uniqueTokens(instrumentTokens)) {
      this.actual.delete(token);
    }
  }

  resetActualAfterDisconnect() {
    this.actual.clear();
  }

  diff(): SubscriptionDiff {
    const subscribe: SubscriptionRecord[] = [];
    const setMode: SubscriptionRecord[] = [];
    const unsubscribe: string[] = [];

    for (const [token, mode] of this.desired) {
      const current = this.actual.get(token);
      if (!current) {
        subscribe.push({ instrumentToken: token, mode });
      } else if (current !== mode) {
        setMode.push({ instrumentToken: token, mode });
      }
    }

    for (const token of this.actual.keys()) {
      if (!this.desired.has(token)) {
        unsubscribe.push(token);
      }
    }

    return { subscribe, unsubscribe, setMode };
  }
}

function uniqueTokens(tokens: string[]) {
  return [...new Set(tokens.map((token) => token.trim()).filter(Boolean))];
}
