import { z } from "zod";

const clockOrIsoTimestampSchema = z.string().min(1);
const clockTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:mm time");

const riskProfileSchema = z
  .object({
    capital: z.number().positive(),
    maxRiskPerTradePercent: z.number().positive(),
    maxDailyLossPercent: z.number().positive(),
    maxTradesPerDay: z.number().int().positive(),
    maxPositionSize: z.number().positive(),
    allowShortSelling: z.boolean(),
    tradeStartTime: clockTimeSchema,
    tradeEndTime: clockTimeSchema
  })
  .strict();

const currentDayStatsSchema = z
  .object({
    dailyLoss: z.number().nonnegative(),
    tradesTaken: z.number().int().nonnegative()
  })
  .strict();

export const createPaperTradeSchema = z.object({
  body: z
    .object({
      signal: z
        .object({
          symbol: z.string().min(1).max(16),
          side: z.enum(["BUY", "SELL", "SHORT"]),
          entryPrice: z.number().positive(),
          stopLoss: z.number().positive().optional(),
          targetPrice: z.number().positive(),
          timestamp: clockOrIsoTimestampSchema
        })
        .strict(),
      riskProfile: riskProfileSchema.optional(),
      currentDayStats: currentDayStatsSchema.optional(),
      strategyName: z.string().min(1).max(80),
      aiExplanation: z.string().min(1).max(1000),
      scannerSignalId: z.string().min(1).optional()
    })
    .strict(),
  params: z.object({}),
  query: z.object({})
});

export const priceTickSchema = z.object({
  body: z
    .object({
      symbol: z.string().min(1).max(16),
      price: z.number().positive(),
      timestamp: clockOrIsoTimestampSchema.optional()
    })
    .strict(),
  params: z.object({}),
  query: z.object({})
});

export const tradeIdParamsSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({
    tradeId: z.string().min(1)
  }),
  query: z.object({})
});

export const cancelTradeSchema = z.object({
  body: z
    .object({
      timestamp: clockOrIsoTimestampSchema.optional()
    })
    .strict()
    .optional(),
  params: z.object({
    tradeId: z.string().min(1)
  }),
  query: z.object({})
});

export const listPaperRecordsSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({}),
  query: z.object({
    status: z.enum(["OPEN", "CLOSED", "CANCELLED", "PENDING", "REJECTED"]).optional(),
    symbol: z.string().min(1).max(16).optional(),
    from: z.string().min(1).optional(),
    to: z.string().min(1).optional()
  })
});

export const positionIdParamsSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({
    positionId: z.string().min(1)
  }),
  query: z.object({})
});

export const closePositionSchema = z.object({
  body: z
    .object({
      exitPrice: z.number().positive().optional(),
      timestamp: clockOrIsoTimestampSchema.optional()
    })
    .strict()
    .optional(),
  params: z.object({
    positionId: z.string().min(1)
  }),
  query: z.object({})
});
