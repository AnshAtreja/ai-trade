import { z } from "zod";

const priceDataSchema = z
  .object({
    currentPrice: z.number().positive().optional(),
    openPrice: z.number().positive().optional(),
    previousClose: z.number().positive().optional(),
    currentVolume: z.number().nonnegative().optional(),
    averageVolume: z.number().positive().optional(),
    dayHigh: z.number().positive().optional(),
    dayLow: z.number().positive().optional(),
    vwap: z.number().positive().optional()
  })
  .strict();

const riskDataSchema = z
  .object({
    invalidationLevel: z.number().positive(),
    maxLoss: z.number().nonnegative().optional(),
    calculatedQuantity: z.number().int().nonnegative().optional(),
    riskPerTradePercent: z.number().nonnegative().optional(),
    rewardToRiskRatio: z.number().nonnegative().optional(),
    rejectionReasons: z.array(z.string()).optional()
  })
  .strict();

export const analyzeScannerOutputSchema = z.object({
  body: z
    .object({
      symbol: z.string().min(1).max(16),
      direction: z.enum(["BULLISH", "BEARISH", "NEUTRAL"]),
      score: z.number().min(0).max(100),
      signals: z.array(z.string()).default([]),
      priceData: priceDataSchema,
      riskData: riskDataSchema
    })
    .strict(),
  params: z.object({}),
  query: z.object({})
});
