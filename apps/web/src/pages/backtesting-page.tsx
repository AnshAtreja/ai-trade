import { PhaseRoadmap, type RoadmapPhase } from "@/components/phase-roadmap";

const phases: RoadmapPhase[] = [
  {
    phase: "8A",
    title: "Historical market data",
    status: "done",
    summary: "Historical candles, storage, coverage validation, and five-minute derivation are available to developer workflows.",
    deliverables: ["Kite and mock data providers", "Calendar-aware dataset checks"]
  },
  {
    phase: "8B",
    title: "Market replay",
    status: "done",
    summary: "Stored candles replay through the production scanner and deterministic strategy engine.",
    deliverables: ["Chronological replay", "Explicit data gaps and no future candles"]
  },
  {
    phase: "8C",
    title: "Historical paper execution",
    status: "done",
    summary: "An isolated in-memory simulator models orders, fills, exits, charges, and incomplete outcomes.",
    deliverables: ["Next-candle order eligibility", "Conservative fill and exit rules"]
  },
  {
    phase: "8D",
    title: "Performance measurement",
    status: "done",
    summary: "Read-only analytics measure completed historical execution results. Reports remain developer CLI output.",
    deliverables: ["Equity and drawdown curves", "Trade, return, and data-quality diagnostics"]
  },
  {
    phase: "8D.5",
    title: "Session-aware validation",
    status: "done",
    summary: "Versioned exchange sessions and CAS eligibility make dataset gaps explicit during historical research preparation.",
    deliverables: ["Versioned market calendar", "Explicit session-policy diagnostics"]
  },
  {
    phase: "8E",
    title: "Walk-forward baseline",
    status: "done",
    summary: "Four chronological folds evaluated the frozen strategies across train, validation, and test periods.",
    deliverables: ["Frozen baseline artifact", "Out-of-sample metrics"]
  },
  {
    phase: "8F",
    title: "Robustness and evidence gate",
    status: "done",
    summary: "Sensitivity, controlled optimization, and the final evidence gate are complete. The v1 strategies remain research baselines with no validated successor.",
    deliverables: ["Cost and parameter evidence", "Final research dispositions"]
  }
];

export function BacktestingPage() {
  return <PhaseRoadmap title="Backtesting" description="Historical research status. Research runs and reports remain developer CLI artifacts." phases={phases} />;
}
