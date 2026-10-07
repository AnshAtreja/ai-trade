import type { OrderRecord } from "./types";

export const mockOrders: OrderRecord[] = [
  { id: "ord_1", symbol: "AAPL", side: "buy", quantity: 25, estimatedCost: 5308.25, mode: "paper", status: "filled" },
  { id: "ord_2", symbol: "TSLA", side: "sell", quantity: 10, estimatedCost: 1784.2, mode: "paper", status: "queued" }
];

