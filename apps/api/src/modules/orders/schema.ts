import { z } from "zod";

export const previewOrderSchema = z.object({
  body: z.object({
    symbol: z.string().min(1).max(10),
    side: z.enum(["buy", "sell"]),
    quantity: z.number().int().positive(),
    price: z.number().positive()
  }),
  params: z.object({}),
  query: z.object({})
});

