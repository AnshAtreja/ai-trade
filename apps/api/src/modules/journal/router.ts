import { Router } from "express";
import { validate } from "../../common/middleware/validate";
import { createJournalEntrySchema } from "./schema";
import { journalService } from "./service";

export const journalRouter = Router();

journalRouter.get("/entries", async (_req, res) => {
  res.json(await journalService.listEntries());
});

journalRouter.post("/entries", validate(createJournalEntrySchema), async (req, res) => {
  res.json(await journalService.createEntry(req.body));
});

