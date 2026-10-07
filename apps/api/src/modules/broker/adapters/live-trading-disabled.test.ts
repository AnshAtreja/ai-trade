import { describe, expect, it } from "vitest";
import { KiteBrokerAdapter } from "./kite-broker-adapter";
import { LIVE_TRADING_DISABLED_MESSAGE } from "./live-trading-disabled";

describe("Kite live trading guard", () => {
  it("makes live order placement impossible", async () => {
    const adapter = new KiteBrokerAdapter({ apiKey: "demo", apiSecret: "demo-secret" });

    await expect(
      adapter.placeOrder({
        symbol: "NSE:RELIANCE",
        exchange: "NSE",
        side: "BUY",
        quantity: 1,
        orderType: "MARKET",
        product: "MIS",
        validity: "DAY"
      })
    ).rejects.toThrow(LIVE_TRADING_DISABLED_MESSAGE);

    await expect(adapter.modifyOrder("order-1", { quantity: 2 })).rejects.toThrow(LIVE_TRADING_DISABLED_MESSAGE);
    await expect(adapter.cancelOrder("order-1")).rejects.toThrow(LIVE_TRADING_DISABLED_MESSAGE);
  });
});
