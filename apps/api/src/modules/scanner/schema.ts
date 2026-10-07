import { z } from "zod";

export const listPersistedSignalsSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({}),
  query: z.object({
    symbol: z.string().min(1).max(16).optional(),
    sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
  })
});

export const createScanSchema = z.object({
  body: z.object({
    universe: z.string().min(2),
    timeframe: z.string().min(2)
  }),
  params: z.object({}),
  query: z.object({})
});

const scannerInstrumentSchema = z
  .object({
    symbol: z.string().min(1).max(16),
    currentPrice: z.number().positive(),
    openPrice: z.number().positive(),
    previousClose: z.number().positive(),
    currentVolume: z.number().nonnegative(),
    averageVolume: z.number().positive(),
    dayHigh: z.number().positive(),
    dayLow: z.number().positive(),
    vwap: z.number().positive().optional(),
    previousHigh: z.number().positive().optional(),
    previousLow: z.number().positive().optional()
  })
  .refine((instrument) => instrument.dayHigh >= instrument.dayLow, {
    message: "dayHigh must be greater than or equal to dayLow",
    path: ["dayHigh"]
  });

export const intradayScanSchema = z.object({
  body: z.object({
    instruments: z.array(scannerInstrumentSchema).min(1),
    options: z
      .object({
        gapThresholdPercent: z.number().positive().optional(),
        volumeSpikeThreshold: z.number().positive().optional(),
        nearHighLowThresholdPercent: z.number().positive().optional()
      })
      .optional()
  }),
  params: z.object({}),
  query: z.object({})
});
