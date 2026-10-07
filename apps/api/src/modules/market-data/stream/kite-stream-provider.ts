import { kiteBrokerAdapter, type KiteBrokerAdapter } from "../../broker/adapters/kite-broker-adapter";
import { MarketStreamError } from "./errors";
import { kiteModeName, type MarketStreamHandlers, type MarketStreamMode, type MarketStreamProvider } from "./types";

export class KiteMarketStreamProvider implements MarketStreamProvider {
  readonly source = "KITE" as const;
  private handlers: MarketStreamHandlers = {};
  private opened = false;

  constructor(private readonly adapter: Pick<
    KiteBrokerAdapter,
    | "isConfigured"
    | "isAuthenticated"
    | "openMarketWebSocket"
    | "sendMarketWebSocket"
    | "closeMarketWebSocket"
    | "isMarketWebSocketOpen"
  > = kiteBrokerAdapter) {}

  setHandlers(handlers: MarketStreamHandlers) {
    this.handlers = handlers;
  }

  async connect() {
    if (!this.adapter.isConfigured() || !this.adapter.isAuthenticated()) {
      throw new MarketStreamError("KITE_NOT_AUTHENTICATED", "Kite access token is missing. Complete Kite login first.");
    }

    this.opened = false;

    await new Promise<void>((resolve, reject) => {
      this.adapter.openMarketWebSocket({
        onOpen: () => {
          this.opened = true;
          this.handlers.onOpen?.();
          resolve();
        },
        onMessage: (data) => this.handlers.onFrame?.(data),
        onClose: (code, reason) => {
          const hadOpened = this.opened;
          this.opened = false;
          this.handlers.onClose?.({ code, reason });
          if (!hadOpened) {
            reject(new Error(reason || `WebSocket closed (${code})`));
          }
        },
        onError: (error) => {
          this.handlers.onError?.(error);
          reject(error);
        }
      });
    });
  }

  async disconnect() {
    this.adapter.closeMarketWebSocket();
    this.opened = false;
  }

  async subscribe(instrumentTokens: string[]) {
    if (instrumentTokens.length === 0) {
      return;
    }
    this.adapter.sendMarketWebSocket({ a: "subscribe", v: instrumentTokens.map(Number) });
  }

  async unsubscribe(instrumentTokens: string[]) {
    if (instrumentTokens.length === 0) {
      return;
    }
    this.adapter.sendMarketWebSocket({ a: "unsubscribe", v: instrumentTokens.map(Number) });
  }

  async setMode(instrumentTokens: string[], mode: MarketStreamMode) {
    if (instrumentTokens.length === 0) {
      return;
    }
    this.adapter.sendMarketWebSocket({ a: "mode", v: [kiteModeName(mode), instrumentTokens.map(Number)] });
  }
}
