import type { InstrumentRecord } from "../../../db/domain";
import type { MarketTick, ParsedTickPacket } from "./types";

export function normalizeParsedTick(
  packet: ParsedTickPacket,
  instrument: InstrumentRecord | null,
  source: "KITE" | "MOCK",
  receivedAt = new Date()
): MarketTick {
  const exchangeTs = packet.exchangeTimestampMs ? new Date(packet.exchangeTimestampMs).toISOString() : null;
  const timestamp = exchangeTs ?? receivedAt.toISOString();
  const orderKey = [
    packet.instrumentToken,
    exchangeTs ?? "",
    String(packet.lastPrice),
    packet.volume ?? "",
    packet.mode
  ].join("|");

  return {
    instrumentToken: packet.instrumentToken,
    exchange: instrument?.exchange ?? null,
    tradingSymbol: instrument?.symbol ?? null,
    instrumentId: instrument?.id ?? null,
    timestamp,
    receivedAt: receivedAt.toISOString(),
    lastPrice: packet.lastPrice,
    volume: packet.volume,
    lastTradedQuantity: packet.lastTradedQuantity,
    open: packet.open,
    high: packet.high,
    low: packet.low,
    close: packet.close,
    averagePrice: packet.averagePrice,
    buyQuantity: packet.buyQuantity,
    sellQuantity: packet.sellQuantity,
    exchangeTimestamp: exchangeTs,
    mode: packet.mode,
    source,
    orderKey
  };
}
