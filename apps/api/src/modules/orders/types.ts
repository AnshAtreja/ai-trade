export interface OrderPreview {
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  estimatedCost: number;
  mode: "paper";
}

export interface OrderRecord extends OrderPreview {
  id: string;
  status: "queued" | "filled" | "cancelled";
}

