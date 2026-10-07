import type { HistoricalCandleIntervalCode } from "../../db/domain";

export interface HistoricalChunk {
  from: Date;
  /** Exclusive end of chunk window. */
  to: Date;
}

/**
 * Split [from, to) into overlapping windows. Overlap is deduped on persistence.
 */
export function buildHistoricalChunks(input: {
  from: Date;
  to: Date;
  interval: HistoricalCandleIntervalCode;
  windowDays: number;
  overlapMinutes: number;
}): HistoricalChunk[] {
  if (!(input.from < input.to)) {
    return [];
  }
  const windowMs = Math.max(1, input.windowDays) * 24 * 60 * 60 * 1000;
  const overlapMs = Math.max(0, input.overlapMinutes) * 60_000;
  const chunks: HistoricalChunk[] = [];
  let cursor = input.from.getTime();
  const end = input.to.getTime();

  while (cursor < end) {
    const chunkEnd = Math.min(cursor + windowMs, end);
    chunks.push({ from: new Date(cursor), to: new Date(chunkEnd) });
    if (chunkEnd >= end) break;
    const next = chunkEnd - overlapMs;
    cursor = next > cursor ? next : chunkEnd;
  }

  return chunks;
}
