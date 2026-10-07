/**
 * Kite broker adapter.
 * persistent: none (tokens are not written to Prisma)
 * mock: see mock-broker-adapter.ts
 * broker integration: login, profile, margins, LTP, historical candles, websocket ticks
 * paper trading: ticks can feed simulated fills; this adapter does not simulate fills itself
 * live trading disabled: placeOrder / modifyOrder / cancelOrder always throw
 */
import { createHash } from "node:crypto";
import WebSocket from "ws";
import { env } from "../../../config/env";
import { scannerService } from "../../scanner/service";
import { parseKiteBinaryFrame } from "../../market-data/stream/kite-binary-parser";
import type {
  BrokerAdapter,
  BrokerInstrument,
  BrokerLtpQuote,
  BrokerMargins,
  BrokerMarketQuote,
  BrokerOrderRequest,
  BrokerOrderResponse,
  BrokerOrderUpdate,
  BrokerProfile,
  HistoricalCandle,
  HistoricalCandleInterval,
  TickSubscription
} from "../types";
import { KiteAccountError, kiteErrorFromHttp } from "../account/errors";
import { LIVE_TRADING_DISABLED_MESSAGE } from "./live-trading-disabled";
import { KiteTokenStore } from "./kite-token-store";

export interface KiteBrokerAdapterConfig {
  apiKey?: string;
  apiSecret?: string;
  accessToken?: string;
  redirectUrl?: string;
  connectionVerificationTtlMs?: number;
  now?: () => Date;
  tokenStore?: KiteTokenStore;
}

export type KiteConnectionState = "NOT_CONFIGURED" | "DISCONNECTED" | "VERIFYING" | "CONNECTED" | "AUTH_REQUIRED" | "ERROR";

export interface KiteConnectionStatus {
  status: KiteConnectionState;
  /** Legacy alias. It is true only for an authenticated read-only verification. */
  brokerConnected: boolean;
  hasStoredSession: boolean;
  verified: boolean;
  lastVerifiedAt: string | null;
  reasonCode: KiteAccountError["code"] | null;
  reason: string;
  marketDataLive: boolean;
  paperTradingModeEnabled: boolean;
  liveTradingDisabled: boolean;
  loginUrl: string | null;
  user: BrokerProfile | null;
}

interface KiteConnectionRecord {
  status: KiteConnectionState;
  lastVerifiedAt: string | null;
  reasonCode: KiteAccountError["code"] | null;
  reason: string;
  user: BrokerProfile | null;
}

const DEFAULT_CONNECTION_VERIFICATION_TTL_MS = 30_000;

export class KiteBrokerAdapter implements BrokerAdapter {
  private readonly config: Required<KiteBrokerAdapterConfig>;
  private readonly tokenStore: KiteTokenStore;
  private readonly now: () => Date;
  private readonly connectionVerificationTtlMs: number;
  private instrumentsCache: BrokerInstrument[] | null = null;
  private socket: WebSocket | null = null;
  private latestTicks = new Map<string, BrokerMarketQuote>();
  private verificationInFlight: Promise<KiteConnectionStatus> | null = null;
  private connection: KiteConnectionRecord = {
    status: "DISCONNECTED",
    lastVerifiedAt: null,
    reasonCode: null,
    reason: "Kite login required.",
    user: null
  };

  constructor(config: KiteBrokerAdapterConfig = {}) {
    this.config = {
      apiKey: config.apiKey ?? env.KITE_API_KEY,
      apiSecret: config.apiSecret ?? env.KITE_API_SECRET,
      accessToken: config.accessToken ?? "",
      redirectUrl: config.redirectUrl ?? env.KITE_REDIRECT_URL,
      connectionVerificationTtlMs: config.connectionVerificationTtlMs ?? DEFAULT_CONNECTION_VERIFICATION_TTL_MS,
      now: config.now ?? (() => new Date()),
      tokenStore: config.tokenStore ?? new KiteTokenStore(config.apiSecret ?? env.KITE_API_SECRET)
    };
    this.tokenStore = this.config.tokenStore;
    this.now = this.config.now;
    this.connectionVerificationTtlMs = this.config.connectionVerificationTtlMs;
  }

  getLoginUrl() {
    this.assertApiKey();

    return `https://kite.zerodha.com/connect/login?v=3&api_key=${encodeURIComponent(this.config.apiKey)}`;
  }

  async exchangeRequestToken(requestToken: string) {
    this.assertConfigured();

    const checksum = createHash("sha256")
      .update(`${this.config.apiKey}${requestToken}${this.config.apiSecret}`)
      .digest("hex");
    const body = new URLSearchParams({
      api_key: this.config.apiKey,
      request_token: requestToken,
      checksum
    });
    const response = await fetch("https://api.kite.trade/session/token", {
      method: "POST",
      headers: {
        "X-Kite-Version": "3",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });
    const payload = await this.parseKiteResponse<KiteSessionResponse>(response);

    this.config.accessToken = payload.access_token;
    this.tokenStore.save({
      accessToken: payload.access_token,
      publicToken: payload.public_token,
      userId: payload.user_id,
      userName: payload.user_name,
      email: payload.email,
      loginTime: payload.login_time,
      storedAt: new Date().toISOString()
    });

    return this.requireVerifiedProfile(await this.getStatus(true));
  }

  async storeAccessToken(accessToken: string) {
    this.assertConfigured();
    this.config.accessToken = accessToken;

    this.tokenStore.save({
      accessToken,
      loginTime: new Date().toISOString(),
      storedAt: new Date().toISOString()
    });

    return this.requireVerifiedProfile(await this.getStatus(true));
  }

  async connect() {
    const status = await this.getStatus();

    return {
      broker: "Kite",
      connected: status.verified,
      mode: "LIVE_DISABLED" as const,
      message: status.reason
    };
  }

  async getProfile(): Promise<BrokerProfile> {
    const data = await this.kiteGet<KiteProfileResponse>("/user/profile");
    const profile = this.toBrokerProfile(data);
    this.recordVerifiedProfile(profile);
    return profile;
  }

  async getMargins(): Promise<BrokerMargins> {
    const data = await this.kiteGet<KiteMarginsResponse>("/user/margins");
    const equity = data.equity;

    return {
      availableCash: Number(equity?.available?.cash ?? 0),
      usedMargin: Number(equity?.utilised?.debits ?? 0),
      net: Number(equity?.net ?? 0)
    };
  }

  async getInstruments(): Promise<BrokerInstrument[]> {
    if (this.instrumentsCache) {
      return this.instrumentsCache;
    }

    return this.fetchInstrumentMaster();
  }

  async fetchInstrumentMaster(): Promise<BrokerInstrument[]> {
    const csv = await this.kiteGetText("/instruments");
    const rows = csv.trim().split("\n").slice(1);

    this.instrumentsCache = rows
      .map(parseInstrumentCsvRow)
      .filter((instrument): instrument is BrokerInstrument => Boolean(instrument));

    return this.instrumentsCache;
  }

  async getLTP(symbols: string[]): Promise<Record<string, BrokerLtpQuote>> {
    const query = this.symbolQuery(symbols);
    const data = await this.kiteGet<Record<string, { last_price: number }>>(`/quote/ltp?${query}`);

    return Object.entries(data).reduce<Record<string, BrokerLtpQuote>>((quotes, [symbol, quote]) => {
      quotes[symbol] = {
        symbol,
        lastPrice: Number(quote.last_price),
        updatedAt: new Date().toISOString()
      };

      return quotes;
    }, {});
  }

  async getQuotes(symbols: string[]): Promise<Record<string, BrokerMarketQuote>> {
    const query = this.symbolQuery(symbols);
    const data = await this.kiteGet<Record<string, KiteQuoteResponse>>(`/quote?${query}`);

    return Object.entries(data).reduce<Record<string, BrokerMarketQuote>>((quotes, [symbol, quote]) => {
      quotes[symbol] = {
        symbol,
        lastPrice: Number(quote.last_price),
        updatedAt: quote.timestamp ?? new Date().toISOString(),
        open: Number(quote.ohlc?.open ?? 0),
        high: Number(quote.ohlc?.high ?? 0),
        low: Number(quote.ohlc?.low ?? 0),
        close: Number(quote.ohlc?.close ?? 0),
        volume: Number(quote.volume ?? 0),
        averagePrice: Number(quote.average_price ?? 0),
        instrumentToken: Number(quote.instrument_token),
        buyQuantity: Number(quote.buy_quantity ?? 0),
        sellQuantity: Number(quote.sell_quantity ?? 0)
      };

      return quotes;
    }, {});
  }

  async getHistoricalCandles(
    symbol: string,
    interval: HistoricalCandleInterval,
    from: string,
    to: string
  ): Promise<HistoricalCandle[]> {
    const instruments = await this.getInstruments();
    const instrument = instruments.find((item) => item.symbol === symbol || `${item.exchange}:${item.symbol}` === symbol);

    if (!instrument) {
      throw new Error(`Instrument not found for ${symbol}`);
    }

    return this.getHistoricalCandlesByToken(String(instrument.instrumentToken), interval, from, to);
  }

  async getHistoricalCandlesByToken(
    instrumentToken: string,
    interval: HistoricalCandleInterval,
    from: string,
    to: string
  ): Promise<HistoricalCandle[]> {
    const data = await this.kiteGet<{
      candles: Array<[string, number, number, number, number, number, number?]>;
    }>(
      `/instruments/historical/${encodeURIComponent(instrumentToken)}/${interval}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&oi=1`
    );

    if (!Array.isArray(data?.candles)) {
      throw new KiteAccountError("KITE_MALFORMED_RESPONSE", "Kite historical response was missing candles array.");
    }

    return data.candles.map((row) => {
      const [timestamp, open, high, low, close, volume, openInterest] = row;
      if (typeof timestamp !== "string" || ![open, high, low, close, volume].every((v) => Number.isFinite(v))) {
        throw new KiteAccountError("KITE_MALFORMED_RESPONSE", "Kite historical candle row was malformed.");
      }
      return {
        timestamp,
        open,
        high,
        low,
        close,
        volume,
        openInterest: openInterest == null || !Number.isFinite(openInterest) ? null : openInterest
      };
    });
  }

  async subscribeTicks(symbols: string[]): Promise<TickSubscription> {
    this.assertAuthenticated();

    const instruments = await this.getInstruments();
    const tokens = symbols
      .map((symbol) => instruments.find((item) => item.symbol === symbol || `${item.exchange}:${item.symbol}` === symbol))
      .filter((instrument): instrument is BrokerInstrument => Boolean(instrument))
      .map((instrument) => Number(instrument.instrumentToken));

    if (tokens.length === 0) {
      throw new Error("No Kite instrument tokens found for requested symbols.");
    }

    this.openTickerSocket(tokens, symbols);

    return {
      id: `kite_ticks_${Date.now()}`,
      symbols,
      status: "MOCK_SUBSCRIBED",
      ticks: [...this.latestTicks.values()].map((tick) => ({
        symbol: tick.symbol,
        lastPrice: tick.lastPrice,
        volume: tick.volume,
        timestamp: tick.updatedAt
      }))
    };
  }

  async placeOrder(_orderRequest: BrokerOrderRequest): Promise<BrokerOrderResponse> {
    throw new Error(LIVE_TRADING_DISABLED_MESSAGE);
  }

  async modifyOrder(_orderId: string, _update: BrokerOrderUpdate): Promise<BrokerOrderResponse> {
    throw new Error(LIVE_TRADING_DISABLED_MESSAGE);
  }

  async cancelOrder(_orderId: string): Promise<BrokerOrderResponse> {
    throw new Error(LIVE_TRADING_DISABLED_MESSAGE);
  }

  /**
   * Returns an authoritative connection result. CONNECTED is emitted only after
   * `/user/profile` has accepted the active session during the bounded cache window.
   */
  async getStatus(forceVerification = false): Promise<KiteConnectionStatus> {
    const immediate = this.getCachedStatus();
    if (immediate.status === "NOT_CONFIGURED" || immediate.status === "DISCONNECTED") {
      return immediate;
    }
    if (!forceVerification && immediate.status === "CONNECTED") {
      return immediate;
    }
    if (this.verificationInFlight) {
      return this.verificationInFlight;
    }

    this.verificationInFlight = this.verifySession();
    try {
      return await this.verificationInFlight;
    } finally {
      this.verificationInFlight = null;
    }
  }

  /** A non-network snapshot for synchronous summaries. It never promotes a stored token to CONNECTED. */
  getCachedStatus(): KiteConnectionStatus {
    if (!this.isConfigured()) {
      return this.toConnectionStatus({
        status: "NOT_CONFIGURED",
        lastVerifiedAt: null,
        reasonCode: null,
        reason: "KITE_API_KEY is missing on the API server.",
        user: null
      });
    }

    if (!this.hasStoredSession()) {
      return this.toConnectionStatus({
        status: "DISCONNECTED",
        lastVerifiedAt: null,
        reasonCode: null,
        reason: "Kite login required. Use Login with Kite or submit a fresh token.",
        user: null
      });
    }

    if (this.connection.status === "CONNECTED" && this.isVerificationFresh()) {
      return this.toConnectionStatus(this.connection);
    }

    if (this.connection.status === "AUTH_REQUIRED" || this.connection.status === "ERROR") {
      return this.toConnectionStatus(this.connection);
    }

    return this.toConnectionStatus({
      status: "VERIFYING",
      lastVerifiedAt: this.connection.lastVerifiedAt,
      reasonCode: null,
      reason: "Kite session is awaiting read-only verification.",
      user: null
    });
  }

  isConfigured() {
    return Boolean(this.config.apiKey);
  }

  isAuthenticated() {
    return this.hasStoredSession();
  }

  /** Read-only Kite GET. Never used to place, modify, or cancel orders. */
  async fetchReadOnly<T>(path: string): Promise<T> {
    return this.kiteGet<T>(path);
  }

  async scanSymbols(symbols: string[]) {
    const quotes = await this.getQuotes(symbols);
    const instruments = Object.values(quotes).map((quote) => ({
      symbol: quote.symbol,
      currentPrice: quote.lastPrice,
      openPrice: quote.open,
      previousClose: quote.close,
      currentVolume: quote.volume,
      averageVolume: Math.max(quote.volume, 1),
      dayHigh: quote.high,
      dayLow: quote.low,
      vwap: quote.averagePrice || undefined,
      previousHigh: quote.high,
      previousLow: quote.low
    }));

    return scannerService.runIntradayScan(instruments);
  }

  /** Single ticker socket. Phase 4 stream reuses this; never a second Kite WS client. */
  openMarketWebSocket(handlers: {
    onOpen: () => void;
    onMessage: (data: Buffer | string) => void;
    onClose: (code: number, reason: string) => void;
    onError: (error: Error) => void;
  }) {
    const session = this.loadSession();
    this.assertApiKey();
    this.closeMarketWebSocket();

    this.socket = new WebSocket(
      `wss://ws.kite.trade?api_key=${encodeURIComponent(this.config.apiKey)}&access_token=${encodeURIComponent(session.accessToken)}`
    );

    this.socket.on("open", () => handlers.onOpen());
    this.socket.on("message", (message) => {
      if (Buffer.isBuffer(message)) {
        handlers.onMessage(message);
        return;
      }

      handlers.onMessage(typeof message === "string" ? message : message.toString());
    });
    this.socket.on("close", (code, reason) => handlers.onClose(code, reason.toString()));
    this.socket.on("error", (error) => handlers.onError(error instanceof Error ? error : new Error(String(error))));
  }

  sendMarketWebSocket(payload: unknown) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Kite market WebSocket is not connected.");
    }

    this.socket.send(JSON.stringify(payload));
  }

  closeMarketWebSocket() {
    if (!this.socket) {
      return;
    }

    this.socket.removeAllListeners();
    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
      this.socket.close();
    }
    this.socket = null;
  }

  isMarketWebSocketOpen() {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  private openTickerSocket(tokens: number[], symbols: string[]) {
    this.openMarketWebSocket({
      onOpen: () => {
        this.sendMarketWebSocket({ a: "subscribe", v: tokens });
        this.sendMarketWebSocket({ a: "mode", v: ["ltp", tokens] });
      },
      onMessage: (message) => {
        if (typeof message === "string") {
          return;
        }

        for (const tick of parseKiteBinaryFrame(message).ticks) {
          const symbol = symbols[tokens.indexOf(Number(tick.instrumentToken))] ?? tick.instrumentToken;
          this.latestTicks.set(symbol, {
            symbol,
            lastPrice: tick.lastPrice,
            updatedAt: new Date().toISOString(),
            open: tick.open ?? 0,
            high: tick.high ?? 0,
            low: tick.low ?? 0,
            close: tick.close ?? 0,
            volume: tick.volume ?? 0,
            instrumentToken: Number(tick.instrumentToken)
          });
        }
      },
      onClose: () => undefined,
      onError: () => undefined
    });
  }

  private async kiteGet<T>(path: string): Promise<T> {
    try {
      const response = await fetch(`https://api.kite.trade${path}`, {
        headers: this.authHeaders()
      });

      return await this.parseKiteResponse<T>(response);
    } catch (error) {
      this.recordReadFailure(error);
      throw error;
    }
  }

  private async kiteGetText(path: string) {
    try {
      const response = await fetch(`https://api.kite.trade${path}`, {
        headers: this.authHeaders()
      });

      if (!response.ok) {
        const body = await response.text();
        throw kiteErrorFromHttp(response.status, body.slice(0, 180) || `Kite request failed with status ${response.status}.`);
      }

      return response.text();
    } catch (error) {
      this.recordReadFailure(error);
      throw error;
    }
  }

  private async parseKiteResponse<T>(response: Response): Promise<T> {
    let payload: { status?: string; data?: T; message?: string; error_type?: string };

    try {
      payload = (await response.json()) as { status?: string; data?: T; message?: string; error_type?: string };
    } catch {
      throw new KiteAccountError("KITE_MALFORMED_RESPONSE", "Kite returned a non-JSON response.");
    }

    if (!response.ok || payload.status !== "success") {
      throw kiteErrorFromHttp(response.status, payload.message ?? `Kite request failed with status ${response.status}.`, payload.error_type);
    }

    return payload.data as T;
  }

  private authHeaders() {
    const session = this.loadSession();

    return {
      "X-Kite-Version": "3",
      Authorization: `token ${this.config.apiKey}:${session.accessToken}`
    };
  }

  private symbolQuery(symbols: string[]) {
    return symbols.map((symbol) => `i=${encodeURIComponent(symbol)}`).join("&");
  }

  private hasStoredSession() {
    return Boolean(this.config.accessToken) || this.tokenStore.hasSession();
  }

  private async verifySession(): Promise<KiteConnectionStatus> {
    this.connection = {
      ...this.connection,
      status: "VERIFYING",
      reasonCode: null,
      reason: "Verifying Kite session with a read-only profile request.",
      user: null
    };

    try {
      await this.getProfile();
    } catch (error) {
      this.recordReadFailure(error);
    }

    return this.toConnectionStatus(this.connection);
  }

  private recordVerifiedProfile(profile: BrokerProfile) {
    this.connection = {
      status: "CONNECTED",
      lastVerifiedAt: this.now().toISOString(),
      reasonCode: null,
      reason: "Kite session verified with a read-only profile request.",
      user: profile
    };
  }

  private recordReadFailure(error: unknown) {
    const lastVerifiedAt = this.connection.lastVerifiedAt;
    if (error instanceof KiteAccountError && (error.code === "KITE_NOT_AUTHENTICATED" || error.code === "KITE_AUTH_EXPIRED")) {
      this.connection = {
        status: "AUTH_REQUIRED",
        lastVerifiedAt,
        reasonCode: error.code,
        reason: "Kite rejected the stored session. Login with Kite again.",
        user: null
      };
      return;
    }

    this.connection = {
      status: "ERROR",
      lastVerifiedAt,
      reasonCode: error instanceof KiteAccountError ? error.code : "KITE_API_ERROR",
      reason: "Kite connection could not be verified. Try refreshing, then login again if the problem persists.",
      user: null
    };
  }

  private isVerificationFresh() {
    return this.connection.lastVerifiedAt != null
      && this.now().getTime() - Date.parse(this.connection.lastVerifiedAt) <= this.connectionVerificationTtlMs;
  }

  private toConnectionStatus(connection: KiteConnectionRecord): KiteConnectionStatus {
    const verified = connection.status === "CONNECTED";
    return {
      status: connection.status,
      brokerConnected: verified,
      hasStoredSession: this.hasStoredSession(),
      verified,
      lastVerifiedAt: connection.lastVerifiedAt,
      reasonCode: connection.reasonCode,
      reason: connection.reason,
      marketDataLive: this.socket?.readyState === WebSocket.OPEN,
      paperTradingModeEnabled: true,
      liveTradingDisabled: true,
      loginUrl: this.config.apiKey ? this.getLoginUrl() : null,
      user: verified ? connection.user : null
    };
  }

  private requireVerifiedProfile(status: KiteConnectionStatus) {
    if (status.verified && status.user) {
      return status.user;
    }
    throw new KiteAccountError(
      status.reasonCode === "KITE_AUTH_EXPIRED" ? "KITE_AUTH_EXPIRED" : status.reasonCode === "KITE_NOT_AUTHENTICATED" ? "KITE_NOT_AUTHENTICATED" : "KITE_API_ERROR",
      status.reason
    );
  }

  private loadSession() {
    try {
      const session = this.config.accessToken
        ? { accessToken: this.config.accessToken, storedAt: new Date().toISOString() }
        : this.tokenStore.load();

      if (!session?.accessToken) {
        throw new KiteAccountError("KITE_NOT_AUTHENTICATED", "Kite access token is missing. Complete Kite login first.");
      }

      return session;
    } catch (error) {
      if (error instanceof KiteAccountError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      if (/unable to authenticate data|Unsupported state|bad decrypt|invalid auth tag/i.test(message)) {
        throw new KiteAccountError(
          "KITE_NOT_AUTHENTICATED",
          "Stored Kite session cannot be decrypted (KITE_API_SECRET likely changed). Delete apps/api/.secure/kite-session.enc and Connect Kite again."
        );
      }
      throw error;
    }
  }

  private assertApiKey() {
    if (!this.config.apiKey) {
      throw new Error("KITE_API_KEY is required for Kite login.");
    }
  }

  private assertConfigured() {
    this.assertApiKey();

    if (!this.config.apiSecret) {
      throw new Error("KITE_API_SECRET is required for Kite token exchange.");
    }
  }

  private assertAuthenticated() {
    this.assertApiKey();
    this.loadSession();
  }

  private toBrokerProfile(data: KiteProfileResponse | KiteSessionResponse): BrokerProfile {
    return {
      userId: data.user_id,
      userName: data.user_name,
      email: data.email,
      broker: data.broker,
      exchanges: data.exchanges,
      products: data.products.filter((product): product is BrokerProfile["products"][number] =>
        ["CNC", "MIS", "NRML"].includes(product)
      )
    };
  }
}

interface KiteSessionResponse extends KiteProfileResponse {
  access_token: string;
  public_token?: string;
  login_time?: string;
}

interface KiteProfileResponse {
  user_id: string;
  user_name: string;
  email: string;
  broker: string;
  exchanges: string[];
  products: string[];
}

interface KiteMarginsResponse {
  equity?: {
    net?: number;
    available?: {
      cash?: number;
    };
    utilised?: {
      debits?: number;
    };
  };
}

interface KiteQuoteResponse {
  instrument_token: number;
  timestamp?: string;
  last_price: number;
  average_price?: number;
  volume?: number;
  buy_quantity?: number;
  sell_quantity?: number;
  ohlc?: {
    open?: number;
    high?: number;
    low?: number;
    close?: number;
  };
}

export function parseInstrumentCsvRow(row: string): BrokerInstrument | null {
  const columns = row.split(",");

  if (columns.length < 12) {
    return null;
  }

  const instrumentToken = columns[0]?.trim();
  const symbol = columns[2]?.trim();
  const exchange = columns[11]?.trim();

  if (!instrumentToken || !symbol || !exchange) {
    return null;
  }

  const expiry = columns[5]?.trim() || null;
  const strikeRaw = Number(columns[6]);
  const strike = Number.isFinite(strikeRaw) && strikeRaw > 0 ? strikeRaw : null;

  return {
    instrumentToken,
    exchangeToken: columns[1]?.trim() || undefined,
    symbol,
    name: columns[3]?.trim() || symbol,
    tickSize: Number(columns[7]) || 0.05,
    lotSize: Number(columns[8]) || 1,
    instrumentType: columns[9]?.trim() || undefined,
    segment: columns[10]?.trim() || exchange,
    exchange,
    expiry,
    strike
  };
}

export const kiteBrokerAdapter = new KiteBrokerAdapter();
