import { z } from "zod";

export const createJournalEntrySchema = z.object({
  body: z.object({
    title: z.string().min(3),
    mood: z.string().min(2),
    tags: z.array(z.string()).default([])
  }),
  params: z.object({}),
  query: z.object({})
});

