import type { ModuleSummary } from "../../common/utils/create-module-summary";
import { mockJournalEntries } from "./mock-data";
import type { JournalEntry } from "./types";

export interface JournalService {
  listEntries: () => Promise<typeof mockJournalEntries>;
  createEntry: (input: Omit<JournalEntry, "id" | "createdAt">) => Promise<JournalEntry>;
  getSummary: () => ModuleSummary;
}

export class MockJournalService implements JournalService {
  async listEntries() {
    return mockJournalEntries;
  }

  async createEntry(input: Omit<JournalEntry, "id" | "createdAt">) {
    return {
      id: `jrnl_${mockJournalEntries.length + 1}`,
      createdAt: new Date().toISOString(),
      ...input
    };
  }

  getSummary(): ModuleSummary {
    return {
      key: "journal",
      title: "Journal",
      description: "Trade journaling is modeled as a structured reflection system with mock persistence.",
      status: "Mocked",
      metrics: [
        { label: "Entries", value: String(mockJournalEntries.length) },
        { label: "Recent mood", value: mockJournalEntries[0]?.mood ?? "n/a" }
      ]
    };
  }
}

export const journalService = new MockJournalService();

