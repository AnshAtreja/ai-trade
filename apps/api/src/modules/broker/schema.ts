import { z } from "zod";

export const ltpQuerySchema = z.object({
  body: z.object({}),
  params: z.object({}),
  query: z.object({
    symbols: z.string().min(1)
  })
});

export const historicalCandlesQuerySchema = z.object({
  body: z.object({}),
  params: z.object({}),
  query: z.object({
    symbol: z.string().min(1),
    interval: z.enum(["minute", "3minute", "5minute", "15minute", "30minute", "day"]),
    from: z.string().min(1),
    to: z.string().min(1)
  })
});

export const subscribeTicksSchema = z.object({
  body: z.object({
    symbols: z.array(z.string().min(1)).min(1)
  }),
  params: z.object({}),
  query: z.object({})
});

export const kiteCallbackSchema = z.object({
  body: z.object({}),
  params: z.object({}),
  query: z.object({
    request_token: z.string().min(1).optional(),
    status: z.string().optional()
  })
});

export const kiteRequestTokenSchema = z.object({
  body: z.object({
    requestToken: z.string().min(1)
  }),
  params: z.object({}),
  query: z.object({})
});

export const kiteAccessTokenSchema = z.object({
  body: z.object({
    accessToken: z.string().min(1)
  }),
  params: z.object({}),
  query: z.object({})
});
