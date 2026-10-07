import { env } from "../../../config/env";
import type { MarketStreamProvider, MarketStreamState } from "./types";

export class ConnectionManager {
  private running = false;
  private generation = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectPromise: Promise<void> | null = null;
  private attempt = 0;
  reconnectCount = 0;
  state: MarketStreamState = "STOPPED";

  constructor(
    private readonly provider: MarketStreamProvider,
    private readonly onState: (state: MarketStreamState) => void,
    private readonly baseMs = env.MARKET_WS_RECONNECT_BASE_MS,
    private readonly maxMs = env.MARKET_WS_RECONNECT_MAX_MS
  ) {}

  isRunning() {
    return this.running;
  }

  async start() {
    if (this.running) {
      return this.connectPromise ?? Promise.resolve();
    }

    this.running = true;
    this.generation += 1;
    this.attempt = 0;
    return this.connect();
  }

  async stop() {
    this.running = false;
    this.generation += 1;
    this.clearReconnect();
    this.connectPromise = null;
    await this.provider.disconnect();
    this.setState("STOPPED");
  }

  async connectOnce() {
    return this.connect();
  }

  delayForAttempt(attempt: number) {
    return Math.min(this.baseMs * 2 ** Math.max(0, attempt), this.maxMs);
  }

  private async connect() {
    if (this.connectPromise) {
      return this.connectPromise;
    }

    const generation = this.generation;
    this.setState(this.reconnectCount > 0 ? "RECONNECTING" : "CONNECTING");

    this.connectPromise = this.provider
      .connect()
      .then(() => {
        if (generation !== this.generation) {
          return;
        }
        this.attempt = 0;
        this.setState("CONNECTED");
      })
      .catch((error: unknown) => {
        if (generation !== this.generation) {
          return;
        }

        const message = error instanceof Error ? error.message : "connect failed";
        if (/not authenticated|access token|TokenException|\b403\b|\b401\b/i.test(message)) {
          this.running = false;
          this.setState("AUTH_FAILED");
          throw error;
        }

        this.scheduleReconnect(generation);
      })
      .finally(() => {
        this.connectPromise = null;
      });

    return this.connectPromise;
  }

  handleDisconnect(reason?: string) {
    if (!this.running) {
      this.setState("STOPPED");
      return;
    }

    if (this.state === "AUTH_FAILED") {
      return;
    }

    if (/not authenticated|access token|TokenException|\b403\b|\b401\b/i.test(reason ?? "")) {
      this.running = false;
      this.setState("AUTH_FAILED");
      return;
    }

    this.setState("DISCONNECTED");
    this.scheduleReconnect(this.generation);
  }

  private scheduleReconnect(generation: number) {
    if (!this.running || generation !== this.generation) {
      return;
    }

    this.clearReconnect();
    const delay = this.delayForAttempt(this.attempt);
    this.attempt += 1;
    this.reconnectCount += 1;
    this.setState("RECONNECTING");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.running || generation !== this.generation) {
        return;
      }
      void this.connect().catch(() => undefined);
    }, delay);
  }

  private clearReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setState(state: MarketStreamState) {
    this.state = state;
    this.onState(state);
  }
}
