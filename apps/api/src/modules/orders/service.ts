import type { ModuleSummary } from "../../common/utils/create-module-summary";
import { mockOrders } from "./mock-data";
import type { OrderPreview } from "./types";

export interface OrdersService {
  listOrders: () => Promise<typeof mockOrders>;
  previewOrder: (input: { symbol: string; side: "buy" | "sell"; quantity: number; price: number }) => Promise<OrderPreview>;
  getSummary: () => ModuleSummary;
}

export class MockOrdersService implements OrdersService {
  async listOrders() {
    return mockOrders;
  }

  async previewOrder(input: { symbol: string; side: "buy" | "sell"; quantity: number; price: number }): Promise<OrderPreview> {
    return {
      symbol: input.symbol,
      side: input.side,
      quantity: input.quantity,
      estimatedCost: Number((input.quantity * input.price).toFixed(2)),
      mode: "paper"
    };
  }

  getSummary(): ModuleSummary {
    return {
      key: "orders",
      title: "Orders",
      description: "Order previews and history are modeled for paper workflows only.",
      status: "Mocked",
      metrics: [
        { label: "Orders", value: String(mockOrders.length) },
        { label: "Queued", value: `${mockOrders.filter((order) => order.status === "queued").length}` }
      ]
    };
  }
}

export const ordersService = new MockOrdersService();
