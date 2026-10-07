import type { InstrumentProvider, InstrumentMasterFetch } from "./instrument-types";
import { MOCK_INSTRUMENTS } from "./mock-instruments";

export class MockInstrumentProvider implements InstrumentProvider {
  readonly source = "MOCK" as const;

  async getInstruments(): Promise<InstrumentMasterFetch> {
    const instruments = structuredClone(MOCK_INSTRUMENTS);
    return { instruments, received: instruments.length, failed: 0 };
  }
}

export const mockInstrumentProvider = new MockInstrumentProvider();
