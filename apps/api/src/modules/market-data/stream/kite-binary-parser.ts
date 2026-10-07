/**
 * Kite WebSocket binary market-data parser.
 * Packet layout: https://kite.trade/docs/connect/v3/websocket/
 *
 * Frame: uint16 BE packet count, then repeating { uint16 BE length, payload }.
 * LTP 8B, QUOTE 44B, FULL 184B. Prices are paise (divide by 100).
 */
import type { ParseError, ParseResult, ParsedTickPacket } from "./types";

const LTP_LENGTH = 8;
const QUOTE_LENGTH = 44;
const FULL_LENGTH = 184;

export function parseKiteBinaryFrame(buffer: Buffer): ParseResult {
  const ticks: ParsedTickPacket[] = [];
  const errors: ParseError[] = [];

  if (buffer.length < 2) {
    errors.push({ code: "TRUNCATED_PACKET", message: "Frame shorter than packet-count header." });
    return { ticks, errors };
  }

  const packetCount = buffer.readUInt16BE(0);
  let offset = 2;

  for (let index = 0; index < packetCount; index += 1) {
    if (offset + 2 > buffer.length) {
      errors.push({ code: "TRUNCATED_PACKET", message: `Packet ${index} header overruns frame.` });
      break;
    }

    const packetLength = buffer.readUInt16BE(offset);
    offset += 2;

    if (packetLength <= 0 || offset + packetLength > buffer.length) {
      errors.push({ code: "TRUNCATED_PACKET", message: `Packet ${index} payload overruns frame.` });
      break;
    }

    const packet = buffer.subarray(offset, offset + packetLength);
    offset += packetLength;

    const parsed = parsePacket(packet);
    if ("error" in parsed) {
      errors.push(parsed.error);
      continue;
    }

    ticks.push(parsed);
  }

  return { ticks, errors };
}

function parsePacket(packet: Buffer): ParsedTickPacket | { error: ParseError } {
  if (packet.length < LTP_LENGTH) {
    return { error: { code: "MALFORMED_PACKET", message: `Packet length ${packet.length} is below LTP minimum.` } };
  }

  try {
    const instrumentToken = String(packet.readUInt32BE(0));
    const lastPrice = packet.readInt32BE(4) / 100;

    if (!Number.isFinite(lastPrice)) {
      return { error: { code: "MALFORMED_PACKET", message: "Non-finite last price." } };
    }

    if (packet.length >= FULL_LENGTH) {
      return {
        instrumentToken,
        lastPrice,
        lastTradedQuantity: packet.readInt32BE(8),
        averagePrice: packet.readInt32BE(12) / 100,
        volume: packet.readInt32BE(16),
        buyQuantity: packet.readInt32BE(20),
        sellQuantity: packet.readInt32BE(24),
        open: packet.readInt32BE(28) / 100,
        high: packet.readInt32BE(32) / 100,
        low: packet.readInt32BE(36) / 100,
        close: packet.readInt32BE(40) / 100,
        exchangeTimestampMs: readUnixSeconds(packet, 60),
        mode: "FULL"
      };
    }

    if (packet.length >= QUOTE_LENGTH) {
      return {
        instrumentToken,
        lastPrice,
        lastTradedQuantity: packet.readInt32BE(8),
        averagePrice: packet.readInt32BE(12) / 100,
        volume: packet.readInt32BE(16),
        buyQuantity: packet.readInt32BE(20),
        sellQuantity: packet.readInt32BE(24),
        open: packet.readInt32BE(28) / 100,
        high: packet.readInt32BE(32) / 100,
        low: packet.readInt32BE(36) / 100,
        close: packet.readInt32BE(40) / 100,
        exchangeTimestampMs: null,
        mode: "QUOTE"
      };
    }

    return {
      instrumentToken,
      lastPrice,
      lastTradedQuantity: null,
      averagePrice: null,
      volume: null,
      buyQuantity: null,
      sellQuantity: null,
      open: null,
      high: null,
      low: null,
      close: null,
      exchangeTimestampMs: null,
      mode: "LTP"
    };
  } catch {
    return { error: { code: "MALFORMED_PACKET", message: "Packet bounds/read failed." } };
  }
}

function readUnixSeconds(packet: Buffer, offset: number) {
  if (offset + 4 > packet.length) {
    return null;
  }

  const seconds = packet.readUInt32BE(offset);
  return seconds > 0 ? seconds * 1000 : null;
}

export function encodeKiteBinaryFrame(packets: Buffer[]) {
  const header = Buffer.alloc(2);
  header.writeUInt16BE(packets.length, 0);
  const chunks: Uint8Array[] = [header];

  for (const packet of packets) {
    const length = Buffer.alloc(2);
    length.writeUInt16BE(packet.length, 0);
    chunks.push(length, packet);
  }

  return Buffer.concat(chunks);
}

export function encodeLtpPacket(instrumentToken: number, lastPricePaise: number) {
  const packet = Buffer.alloc(LTP_LENGTH);
  packet.writeUInt32BE(instrumentToken, 0);
  packet.writeInt32BE(lastPricePaise, 4);
  return packet;
}

export function encodeQuotePacket(input: {
  instrumentToken: number;
  lastPricePaise: number;
  lastTradedQuantity?: number;
  averagePricePaise?: number;
  volume?: number;
  buyQuantity?: number;
  sellQuantity?: number;
  openPaise?: number;
  highPaise?: number;
  lowPaise?: number;
  closePaise?: number;
}) {
  const packet = Buffer.alloc(QUOTE_LENGTH);
  packet.writeUInt32BE(input.instrumentToken, 0);
  packet.writeInt32BE(input.lastPricePaise, 4);
  packet.writeInt32BE(input.lastTradedQuantity ?? 0, 8);
  packet.writeInt32BE(input.averagePricePaise ?? 0, 12);
  packet.writeInt32BE(input.volume ?? 0, 16);
  packet.writeInt32BE(input.buyQuantity ?? 0, 20);
  packet.writeInt32BE(input.sellQuantity ?? 0, 24);
  packet.writeInt32BE(input.openPaise ?? 0, 28);
  packet.writeInt32BE(input.highPaise ?? 0, 32);
  packet.writeInt32BE(input.lowPaise ?? 0, 36);
  packet.writeInt32BE(input.closePaise ?? 0, 40);
  return packet;
}

export function encodeFullPacket(
  input: Parameters<typeof encodeQuotePacket>[0] & { exchangeTimestampSeconds?: number }
) {
  const packet = Buffer.alloc(FULL_LENGTH);
  encodeQuotePacket(input).copy(packet, 0, 0, QUOTE_LENGTH);
  packet.writeUInt32BE(input.exchangeTimestampSeconds ?? 0, 60);
  return packet;
}
