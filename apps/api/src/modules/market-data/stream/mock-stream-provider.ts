import { encodeKiteBinaryFrame, encodeLtpPacket } from "./kite-binary-parser";
import type { MarketStreamHandlers, MarketStreamMode, MarketStreamProvider } from "./types";

export class MockMarketStreamProvider implements MarketStreamProvider {
  readonly source = "MOCK" as const;
  connected = false;
  subscribed = new Set<string>();
  modes = new Map<string, MarketStreamMode>();
  connectCalls = 0;
  disconnectCalls = 0;
  failNextConnect = false;
  alwaysFailConnect = false;
  closeOnConnect = false;
  autoTickMs: number;
  private handlers: MarketStreamHandlers = {};
  private timer: ReturnType<typeof setInterval> | null = null;
  private seq = 0;

  constructor(autoTickMs = 100) {
    this.autoTickMs = autoTickMs;
  }

  setHandlers(handlers: MarketStreamHandlers) {
    this.handlers = handlers;
  }

  async connect() {
    this.connectCalls += 1;
    if (this.alwaysFailConnect || this.failNextConnect) {
      this.failNextConnect = false;
      throw new Error("mock connect failed");
    }

    this.connected = true;
    this.handlers.onOpen?.();
    this.startAutoTicks();

    if (this.closeOnConnect) {
      this.closeOnConnect = false;
      this.simulateDisconnect("mock drop");
    }
  }

  async disconnect() {
    this.disconnectCalls += 1;
    this.stopAutoTicks();
    this.connected = false;
  }

  async subscribe(instrumentTokens: string[]) {
    for (const token of instrumentTokens) {
      this.subscribed.add(token);
      if (!this.modes.has(token)) {
        this.modes.set(token, "LTP");
      }
    }
  }

  async unsubscribe(instrumentTokens: string[]) {
    for (const token of instrumentTokens) {
      this.subscribed.delete(token);
      this.modes.delete(token);
    }
  }

  async setMode(instrumentTokens: string[], mode: MarketStreamMode) {
    for (const token of instrumentTokens) {
      if (this.subscribed.has(token)) {
        this.modes.set(token, mode);
      }
    }
  }

  emitLtp(instrumentToken: string, lastPrice: number) {
    const paise = Math.round(lastPrice * 100);
    this.handlers.onFrame?.(encodeKiteBinaryFrame([encodeLtpPacket(Number(instrumentToken), paise)]));
  }

  emitFrame(buffer: Buffer) {
    this.handlers.onFrame?.(buffer);
  }

  emitText(value: string) {
    this.handlers.onFrame?.(value);
  }

  simulateDisconnect(reason = "mock disconnect") {
    this.stopAutoTicks();
    this.connected = false;
    this.handlers.onClose?.({ code: 1006, reason });
  }

  simulateReconnect() {
    this.connected = true;
    this.handlers.onOpen?.();
    this.startAutoTicks();
  }

  private startAutoTicks() {
    this.stopAutoTicks();
    if (this.autoTickMs <= 0) {
      return;
    }

    this.timer = setInterval(() => {
      for (const token of this.subscribed) {
        this.seq += 1;
        this.emitLtp(token, 100 + (this.seq % 50) + 0.25);
      }
    }, this.autoTickMs);

    if (typeof this.timer === "object" && "unref" in this.timer) {
      this.timer.unref();
    }
  }

  private stopAutoTicks() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
