import { isDatabasePersistenceEnabled } from "../../../config/env";
import { env } from "../../../config/env";
import { kiteBrokerAdapter } from "../../broker/adapters/kite-broker-adapter";
import { MarketStreamError } from "./errors";
import { ConnectionManager } from "./connection-manager";
import { MarketTickEventBus } from "./event-bus";
import { InstrumentTokenIndex } from "./instrument-index";
import { parseKiteBinaryFrame } from "./kite-binary-parser";
import { KiteMarketStreamProvider } from "./kite-stream-provider";
import { LatestMarketStateStore } from "./latest-state-store";
import { StreamLogger } from "./logger";
import { MockMarketStreamProvider } from "./mock-stream-provider";
import { normalizeParsedTick } from "./normalize";
import { MarketSnapshotPersistenceService } from "./snapshot-persistence";
import { SubscriptionManager } from "./subscription-manager";
import type { MarketStreamMode, MarketStreamProvider, MarketStreamState, MarketStreamStatus } from "./types";
import { parseMarketStreamMode } from "./types";

export class MarketStreamService {
  readonly store: LatestMarketStateStore;
  readonly bus: MarketTickEventBus;
  readonly subscriptions = new SubscriptionManager();
  readonly index: InstrumentTokenIndex;
  readonly persistence: MarketSnapshotPersistenceService;
  readonly logger: StreamLogger;
  readonly provider: MarketStreamProvider;
  readonly connection: ConnectionManager;

  private queue: Promise<unknown> = Promise.resolve();
  private connectedAt: string | null = null;
  private lastMessageAt: string | null = null;
  private lastError: MarketStreamStatus["lastError"] = null;
  private unknownTokens = new Set<string>();

  constructor(options?: {
    provider?: MarketStreamProvider;
    autoTickMs?: number;
    reconnectBaseMs?: number;
    reconnectMaxMs?: number;
  }) {
    this.logger = new StreamLogger();
    this.store = new LatestMarketStateStore();
    this.bus = new MarketTickEventBus((error, meta) => {
      this.logger.error("market_stream_consumer_error", error instanceof Error ? error.message : "Consumer failed.", {
        errorCode: "MARKET_STREAM_CONSUMER_ERROR",
        ...meta
      });
    });
    this.index = new InstrumentTokenIndex();
    this.persistence = new MarketSnapshotPersistenceService(this.store, this.logger);
    this.provider =
      options?.provider ??
      (isDatabasePersistenceEnabled()
        ? new KiteMarketStreamProvider()
        : new MockMarketStreamProvider(options?.autoTickMs ?? 100));
    this.connection = new ConnectionManager(
      this.provider,
      (state) => this.handleState(state),
      options?.reconnectBaseMs ?? env.MARKET_WS_RECONNECT_BASE_MS,
      options?.reconnectMaxMs ?? env.MARKET_WS_RECONNECT_MAX_MS
    );
    this.provider.setHandlers({
      onOpen: () => {
        this.connectedAt = new Date().toISOString();
        this.lastError = null;
        this.subscriptions.resetActualAfterDisconnect();
      },
      onClose: (info) => {
        this.subscriptions.resetActualAfterDisconnect();
        this.connection.handleDisconnect(info.reason);
      },
      onError: (error) => {
        this.lastError = { code: "MARKET_STREAM_ERROR", message: error.message };
        this.connection.handleDisconnect(error.message);
      },
      onFrame: (data) => this.handleFrame(data)
    });
  }

  getStatus(): MarketStreamStatus {
    const state = this.connection.state;
    const connected = state === "CONNECTED";
    const receiving = connected && Boolean(
      this.lastMessageAt && Date.now() - Date.parse(this.lastMessageAt) <= env.MARKET_TICK_STALE_MS
    );

    return {
      state,
      running: this.connection.isRunning(),
      connected,
      receiving,
      connectedAt: this.connectedAt,
      lastMessageAt: this.lastMessageAt,
      reconnectCount: this.connection.reconnectCount,
      subscriptionCount: this.subscriptions.size(),
      lastError: this.lastError,
      source: this.provider.source
    };
  }

  start() {
    return this.enqueue(async () => {
      if (this.provider.source === "KITE" && (!kiteBrokerAdapter.isConfigured() || !kiteBrokerAdapter.isAuthenticated())) {
        throw new MarketStreamError("KITE_NOT_AUTHENTICATED", "Kite access token is missing. Complete Kite login first.");
      }

      await this.index.refresh();
      this.logger.info("market_stream_connecting", "Market stream connecting.", {
        connectionState: this.connection.state,
        subscriptionCount: this.subscriptions.size()
      });
      try {
        await this.connection.start();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to start market stream.";
        this.lastError = { code: this.connection.state === "AUTH_FAILED" ? "MARKET_STREAM_AUTH_FAILED" : "MARKET_STREAM_ERROR", message };
        if (this.connection.state === "AUTH_FAILED") {
          throw new MarketStreamError("MARKET_STREAM_AUTH_FAILED", message);
        }
        throw new MarketStreamError("MARKET_STREAM_ERROR", message);
      }
      this.persistence.start();
      return this.getStatus();
    });
  }

  stop() {
    return this.enqueue(async () => {
      this.persistence.stop();
      await this.connection.stop();
      this.subscriptions.resetActualAfterDisconnect();
      this.logger.info("market_stream_disconnected", "Market stream stopped.", {
        connectionState: "STOPPED",
        subscriptionCount: this.subscriptions.size()
      });
      return this.getStatus();
    });
  }

  subscribe(instrumentTokens: string[], mode?: MarketStreamMode) {
    return this.enqueue(async () => {
      const resolved = await this.requireKnownTokens(instrumentTokens);
      this.subscriptions.subscribe(resolved, mode ?? "LTP");
      await this.reconcileSubscriptions();
      this.bus.emitSubscriptionChange(this.subscriptions.getDesired());
      this.logger.info("market_stream_subscribed", "Subscriptions updated.", {
        subscriptionCount: this.subscriptions.size()
      });
      return this.subscriptions.getDesired();
    });
  }

  unsubscribe(instrumentTokens: string[]) {
    return this.enqueue(async () => {
      this.subscriptions.unsubscribe(instrumentTokens);
      for (const token of instrumentTokens) {
        this.store.remove(token);
      }
      await this.reconcileSubscriptions();
      this.bus.emitSubscriptionChange(this.subscriptions.getDesired());
      this.logger.info("market_stream_unsubscribed", "Subscriptions updated.", {
        subscriptionCount: this.subscriptions.size()
      });
      return this.subscriptions.getDesired();
    });
  }

  listSubscriptions() {
    return this.subscriptions.getDesired();
  }

  getLatest(instrumentToken: string) {
    const tick = this.store.getLatest(instrumentToken);
    if (!tick) {
      throw new MarketStreamError("UNKNOWN_INSTRUMENT_TOKEN", `No latest tick for ${instrumentToken}.`);
    }

    return {
      ...tick,
      stale: this.store.isStale(instrumentToken)
    };
  }

  getLatestAll() {
    return this.store.getAll().map((tick) => ({
      ...tick,
      stale: this.store.isStale(tick.instrumentToken)
    }));
  }

  persistSnapshots() {
    return this.persistence.persistLatest();
  }

  private handleState(state: MarketStreamState) {
    if (state === "CONNECTED") {
      this.logger.info("market_stream_connected", "Market stream connected.", { connectionState: state });
      void this.enqueue(() => this.reconcileSubscriptions());
    } else if (state === "RECONNECTING") {
      this.logger.warn("market_stream_reconnecting", "Market stream reconnecting.", { connectionState: state });
    } else if (state === "DISCONNECTED" || state === "STOPPED") {
      this.logger.info("market_stream_disconnected", "Market stream disconnected.", { connectionState: state });
    }
    this.bus.emitConnectionState(state);
  }

  private handleFrame(data: Buffer | string) {
    this.lastMessageAt = new Date().toISOString();

    if (typeof data === "string") {
      this.handleTextFrame(data);
      return;
    }

    const parsed = parseKiteBinaryFrame(data);
    for (const error of parsed.errors) {
      this.logger.parseError(error.message, { errorCode: error.code });
    }

    for (const packet of parsed.ticks) {
      const instrument = this.index.get(packet.instrumentToken);
      if (!instrument) {
        if (!this.unknownTokens.has(packet.instrumentToken)) {
          this.unknownTokens.add(packet.instrumentToken);
          this.logger.warn("market_stream_unknown_instrument", "Tick for unknown instrument token.", {
            instrumentToken: packet.instrumentToken,
            errorCode: "UNKNOWN_INSTRUMENT_TOKEN"
          });
        }
        continue;
      }

      const tick = normalizeParsedTick(packet, instrument, this.provider.source);
      const result = this.store.set(tick);
      if (result === "out_of_order") {
        this.logger.warn("market_stream_stale_tick", "Out-of-order tick ignored for latest state.", {
          instrumentToken: tick.instrumentToken,
          tradingSymbol: tick.tradingSymbol ?? undefined
        });
        continue;
      }
      if (result === "duplicate") {
        continue;
      }

      this.bus.emitTick(tick);
    }
  }

  private handleTextFrame(data: string) {
    try {
      const payload = JSON.parse(data) as { type?: string; data?: unknown };
      if (payload.type === "error") {
        const message = typeof payload.data === "string" ? payload.data : "Kite WebSocket error.";
        this.lastError = { code: "MARKET_STREAM_ERROR", message };
        this.logger.error("market_stream_parse_error", message, { errorCode: "MARKET_STREAM_ERROR" });
      }
    } catch {
      this.logger.parseError("Non-binary WebSocket frame was not valid JSON.", { errorCode: "INVALID_FRAME" });
    }
  }

  private async reconcileSubscriptions() {
    if (!this.connection.isRunning() || this.connection.state !== "CONNECTED") {
      return;
    }

    const diff = this.subscriptions.diff();
    if (diff.unsubscribe.length > 0) {
      await this.provider.unsubscribe(diff.unsubscribe);
      this.subscriptions.removeActual(diff.unsubscribe);
    }

    const grouped = new Map<MarketStreamMode, string[]>();
    for (const item of diff.subscribe) {
      const list = grouped.get(item.mode) ?? [];
      list.push(item.instrumentToken);
      grouped.set(item.mode, list);
    }

    for (const [mode, tokens] of grouped) {
      await this.provider.subscribe(tokens);
      await this.provider.setMode(tokens, mode);
      this.subscriptions.markActual(tokens, mode);
    }

    if (diff.setMode.length > 0) {
      const byMode = new Map<MarketStreamMode, string[]>();
      for (const item of diff.setMode) {
        const list = byMode.get(item.mode) ?? [];
        list.push(item.instrumentToken);
        byMode.set(item.mode, list);
      }
      for (const [mode, tokens] of byMode) {
        await this.provider.setMode(tokens, mode);
        this.subscriptions.markActual(tokens, mode);
      }
    }
  }

  private async requireKnownTokens(tokens: string[]) {
    if (this.index.size() === 0) {
      await this.index.refresh();
    }

    const unique = [...new Set(tokens.map((token) => token.trim()).filter(Boolean))];
    if (unique.length === 0) {
      throw new MarketStreamError("INVALID_STREAM_REQUEST", "instrumentTokens must not be empty.");
    }

    for (const token of unique) {
      if (!await this.index.ensure(token)) {
        throw new MarketStreamError("UNKNOWN_INSTRUMENT_TOKEN", `Instrument token ${token} is not in the synchronized master.`);
      }
    }

    return unique;
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work);
    this.queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }
}

export function parseStreamMode(value: string | undefined) {
  return parseMarketStreamMode(value);
}

let singleton: MarketStreamService | null = null;

export function getMarketStreamService() {
  singleton ??= new MarketStreamService();
  return singleton;
}

export function resetMarketStreamServiceForTests(next?: MarketStreamService) {
  if (singleton) {
    singleton.persistence.stop();
  }
  singleton = next ?? null;
}
