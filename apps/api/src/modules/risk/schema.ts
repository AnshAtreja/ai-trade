import { z } from "zod";

const clockTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:mm time");

export const validateTradeSchema = z.object({
  body: z.object({
    signal: z.object({
      symbol: z.string().min(1).max(16),
      side: z.enum(["BUY", "SELL", "SHORT"]),
      entryPrice: z.number().positive(),
      stopLoss: z.number().positive().optional(),
      targetPrice: z.number().positive(),
      quantity: z.number(),
      timestamp: z.string().min(1)
    }),
    riskProfile: z.object({
      capital: z.number().positive(),
      maxRiskPerTradePercent: z.number().positive(),
      maxDailyLossPercent: z.number().positive(),
      maxTradesPerDay: z.number().int().positive(),
      maxPositionSize: z.number().positive(),
      allowShortSelling: z.boolean(),
      tradeStartTime: clockTimeSchema,
      tradeEndTime: clockTimeSchema
    }),
    currentDayStats: z.object({
      dailyLoss: z.number().nonnegative(),
      tradesTaken: z.number().int().nonnegative()
    })
  }),
  params: z.object({}),
  query: z.object({})
});
