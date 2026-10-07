import type { PaperAccount } from "./types";

/** Legacy fixture only. Live paper account state is derived by AccountStateService. */
export const mockPaperAccount: PaperAccount = {
  tradingMode: "PAPER",
  startingCapital: 100000,
  currentEquity: 100000,
  availableCapital: 100000,
  usedCapital: 0,
  realisedPnl: 0,
  unrealisedPnl: 0,
  totalPnl: 0,
  dayPnl: 0,
  openExposure: 0,
  tradesToday: 0,
  openPositions: 0,
  riskUsedToday: 0,
  riskRemainingToday: 3000,
  status: "ACTIVE"
};
