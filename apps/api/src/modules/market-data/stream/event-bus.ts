import type { MarketStreamState, MarketTick, SubscriptionRecord } from "./types";

export type TickHandler = (tick: MarketTick) => void | Promise<void>;
export type ConnectionHandler = (state: MarketStreamState) => void | Promise<void>;
export type SubscriptionHandler = (subscriptions: SubscriptionRecord[]) => void | Promise<void>;

/**
 * In-process bus. Tick delivery is latest-value-wins per instrument per flush.
 * Consumers that need every tick must not use this bus (document in Phase 4 docs).
 * LatestMarketStateStore still sees every valid applied tick on the socket thread.
 */
export class MarketTickEventBus {
  private readonly tickHandlers = new Set<TickHandler>();
  private readonly connectionHandlers = new Set<ConnectionHandler>();
  private readonly subscriptionHandlers = new Set<SubscriptionHandler>();
  private pendingTicks = new Map<string, MarketTick>();
  private scheduled = false;
  private readonly onConsumerError: (error: unknown, meta: Record<string, string>) => void;

  constructor(onConsumerError: (error: unknown, meta: Record<string, string>) => void = () => undefined) {
    this.onConsumerError = onConsumerError;
  }

  onTick(handler: TickHandler) {
    this.tickHandlers.add(handler);
    return () => this.tickHandlers.delete(handler);
  }

  onConnectionStateChange(handler: ConnectionHandler) {
    this.connectionHandlers.add(handler);
    return () => this.connectionHandlers.delete(handler);
  }

  onSubscriptionChange(handler: SubscriptionHandler) {
    this.subscriptionHandlers.add(handler);
    return () => this.subscriptionHandlers.delete(handler);
  }

  emitTick(tick: MarketTick) {
    this.pendingTicks.set(tick.instrumentToken, tick);
    this.scheduleFlush();
  }

  emitConnectionState(state: MarketStreamState) {
    for (const handler of this.connectionHandlers) {
      this.safeRun(handler, state, { kind: "connection" });
    }
  }

  emitSubscriptionChange(subscriptions: SubscriptionRecord[]) {
    for (const handler of this.subscriptionHandlers) {
      this.safeRun(handler, subscriptions, { kind: "subscription" });
    }
  }

  pendingCount() {
    return this.pendingTicks.size;
  }

  private scheduleFlush() {
    if (this.scheduled) {
      return;
    }

    this.scheduled = true;
    setImmediate(() => this.flush());
  }

  private flush() {
    this.scheduled = false;
    const batch = [...this.pendingTicks.values()];
    this.pendingTicks.clear();

    for (const tick of batch) {
      for (const handler of this.tickHandlers) {
        this.safeRun(handler, tick, { kind: "tick", instrumentToken: tick.instrumentToken });
      }
    }
  }

  private safeRun(handler: (value: never) => void | Promise<void>, value: unknown, meta: Record<string, string>) {
    try {
      const result = handler(value as never);
      if (result && typeof result.then === "function") {
        void result.catch((error) => this.onConsumerError(error, meta));
      }
    } catch (error) {
      this.onConsumerError(error, meta);
    }
  }
}
