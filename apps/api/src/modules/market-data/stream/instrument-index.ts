import type { InstrumentRecord } from "../../../db/domain";
import type { AppRepositories } from "../../../db/repositories/contracts";
import { getRepositories } from "../../../db/persistence";

export class InstrumentTokenIndex {
  private byToken = new Map<string, InstrumentRecord>();

  constructor(private readonly resolveRepos: () => AppRepositories = getRepositories) {}

  async refresh() {
    const rows = await this.resolveRepos().instruments.list({ limit: 50000 });
    const next = new Map<string, InstrumentRecord>();
    for (const row of rows) {
      if (row.instrumentToken) {
        next.set(row.instrumentToken, row);
      }
    }
    this.byToken = next;
    return this.byToken.size;
  }

  get(instrumentToken: string) {
    return this.byToken.get(instrumentToken) ?? null;
  }

  async ensure(instrumentToken: string) {
    const cached = this.get(instrumentToken);
    if (cached) return cached;
    const resolved = await this.resolveRepos().instruments.findByInstrumentToken(instrumentToken);
    if (resolved) this.byToken.set(instrumentToken, resolved);
    return resolved;
  }

  size() {
    return this.byToken.size;
  }
}
