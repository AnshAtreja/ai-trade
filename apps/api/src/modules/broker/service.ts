import type { ModuleSummary } from "../../common/utils/create-module-summary";
import { kiteBrokerAdapter } from "./adapters/kite-broker-adapter";
import { mockBrokerAdapter } from "./adapters/mock-broker-adapter";
import { mockBrokerConnections, supportedBrokers } from "./mock-data";
import type { HistoricalCandleInterval } from "./types";

export interface BrokerService {
  listConnections: () => Promise<typeof mockBrokerConnections>;
  listSupportedBrokers: () => Promise<string[]>;
  connectMockBroker: () => ReturnType<typeof mockBrokerAdapter.connect>;
  getMockProfile: () => ReturnType<typeof mockBrokerAdapter.getProfile>;
  getMockMargins: () => ReturnType<typeof mockBrokerAdapter.getMargins>;
  getMockInstruments: () => ReturnType<typeof mockBrokerAdapter.getInstruments>;
  getMockLTP: (symbols: string[]) => ReturnType<typeof mockBrokerAdapter.getLTP>;
  getMockHistoricalCandles: (
    symbol: string,
    interval: HistoricalCandleInterval,
    from: string,
    to: string
  ) => ReturnType<typeof mockBrokerAdapter.getHistoricalCandles>;
  subscribeMockTicks: (symbols: string[]) => ReturnType<typeof mockBrokerAdapter.subscribeTicks>;
  getKiteLoginUrl: () => string;
  completeKiteLogin: (requestToken: string) => ReturnType<typeof kiteBrokerAdapter.exchangeRequestToken>;
  storeKiteAccessToken: (accessToken: string) => ReturnType<typeof kiteBrokerAdapter.storeAccessToken>;
  getKiteStatus: () => ReturnType<typeof kiteBrokerAdapter.getStatus>;
  getKiteProfile: () => ReturnType<typeof kiteBrokerAdapter.getProfile>;
  getKiteMargins: () => ReturnType<typeof kiteBrokerAdapter.getMargins>;
  getKiteInstruments: () => ReturnType<typeof kiteBrokerAdapter.getInstruments>;
  getKiteLTP: (symbols: string[]) => ReturnType<typeof kiteBrokerAdapter.getLTP>;
  getKiteHistoricalCandles: (
    symbol: string,
    interval: HistoricalCandleInterval,
    from: string,
    to: string
  ) => ReturnType<typeof kiteBrokerAdapter.getHistoricalCandles>;
  subscribeKiteTicks: (symbols: string[]) => ReturnType<typeof kiteBrokerAdapter.subscribeTicks>;
  getKiteScannerCandidates: (symbols: string[]) => ReturnType<typeof kiteBrokerAdapter.scanSymbols>;
  getSummary: () => ModuleSummary;
}

export class MockBrokerService implements BrokerService {
  async listConnections() {
    return mockBrokerConnections;
  }

  async listSupportedBrokers() {
    return supportedBrokers;
  }

  connectMockBroker() {
    return mockBrokerAdapter.connect();
  }

  getMockProfile() {
    return mockBrokerAdapter.getProfile();
  }

  getMockMargins() {
    return mockBrokerAdapter.getMargins();
  }

  getMockInstruments() {
    return mockBrokerAdapter.getInstruments();
  }

  getMockLTP(symbols: string[]) {
    return mockBrokerAdapter.getLTP(symbols);
  }

  getMockHistoricalCandles(symbol: string, interval: HistoricalCandleInterval, from: string, to: string) {
    return mockBrokerAdapter.getHistoricalCandles(symbol, interval, from, to);
  }

  subscribeMockTicks(symbols: string[]) {
    return mockBrokerAdapter.subscribeTicks(symbols);
  }

  getKiteLoginUrl() {
    return kiteBrokerAdapter.getLoginUrl();
  }

  completeKiteLogin(requestToken: string) {
    return kiteBrokerAdapter.exchangeRequestToken(requestToken);
  }

  storeKiteAccessToken(accessToken: string) {
    return kiteBrokerAdapter.storeAccessToken(accessToken);
  }

  getKiteStatus() {
    return kiteBrokerAdapter.getStatus();
  }

  getKiteProfile() {
    return kiteBrokerAdapter.getProfile();
  }

  getKiteMargins() {
    return kiteBrokerAdapter.getMargins();
  }

  getKiteInstruments() {
    return kiteBrokerAdapter.getInstruments();
  }

  getKiteLTP(symbols: string[]) {
    return kiteBrokerAdapter.getLTP(symbols);
  }

  getKiteHistoricalCandles(symbol: string, interval: HistoricalCandleInterval, from: string, to: string) {
    return kiteBrokerAdapter.getHistoricalCandles(symbol, interval, from, to);
  }

  subscribeKiteTicks(symbols: string[]) {
    return kiteBrokerAdapter.subscribeTicks(symbols);
  }

  getKiteScannerCandidates(symbols: string[]) {
    return kiteBrokerAdapter.scanSymbols(symbols);
  }

  getSummary(): ModuleSummary {
    const kiteStatus = kiteBrokerAdapter.getCachedStatus();

    return {
      key: "broker",
      title: "Broker",
      description: "Broker adapter contracts are defined with mock data and a Kite skeleton; live order methods are disabled.",
      status: kiteStatus.verified ? "Kite Data Connected" : kiteStatus.status === "AUTH_REQUIRED" ? "Kite Login Required" : "Kite Verification Required",
      metrics: [
        { label: "Connections", value: String(mockBrokerConnections.length) },
        { label: "Market data", value: kiteStatus.marketDataLive ? "Live" : "Disconnected" }
      ]
    };
  }
}

export const brokerService = new MockBrokerService();
