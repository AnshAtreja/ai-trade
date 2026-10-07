import type { BrokerConnection } from "./types";

export const mockBrokerConnections: BrokerConnection[] = [
  { id: "broker_1", broker: "Alpaca Sandbox", accountMask: "****1042", status: "sandbox" },
  { id: "broker_2", broker: "Interactive Brokers", accountMask: "****8831", status: "disconnected" }
];

export const supportedBrokers = ["Mock Broker", "Kite", "Alpaca Sandbox", "Interactive Brokers", "Tradier", "Robinhood"];
