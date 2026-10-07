import { z } from "zod";

export const evaluateStrategiesSchema = z.object({
  body: z.object({
    instrumentTokens: z.array(z.union([z.string(), z.number()])).optional(),
    strategyIds: z.array(z.string().min(1)).optional(),
    force: z.boolean().optional()
  }),
  params: z.object({}),
  query: z.object({})
});

export const listStrategySignalsSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({}),
  query: z.object({
    strategyId: z.string().optional(),
    symbol: z.string().optional(),
    limit: z.coerce.number().int().positive().max(500).optional()
  })
});
