import { z } from "zod";

const intervalSchema = z.enum(["1m", "5m"]);

export const downloadHistoricalSchema = z.object({
  body: z.object({
    instrumentToken: z.string().min(1),
    tradingSymbol: z.string().optional(),
    exchange: z.string().optional(),
    interval: intervalSchema.optional(),
    from: z.string().min(1),
    to: z.string().min(1),
    reconcile: z.boolean().optional()
  }),
  params: z.object({}),
  query: z.object({})
});

export const validateHistoricalSchema = z.object({
  body: z.object({
    instrumentToken: z.string().min(1),
    interval: intervalSchema.optional(),
    from: z.string().min(1),
    to: z.string().min(1)
  }),
  params: z.object({}),
  query: z.object({})
});

export const listHistoricalCandlesSchema = z.object({
  body: z.object({}),
  params: z.object({}),
  query: z.object({
    instrumentToken: z.string().min(1),
    interval: intervalSchema.optional(),
    from: z.string().min(1),
    to: z.string().min(1),
    derive5m: z.enum(["true", "false"]).optional()
  })
});

export const coverageHistoricalSchema = z.object({
  body: z.object({}),
  params: z.object({}),
  query: z.object({
    instrumentToken: z.string().optional(),
    interval: intervalSchema.optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    limit: z.string().optional()
  })
});
