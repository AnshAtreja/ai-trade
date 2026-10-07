import { PhaseRoadmap, type RoadmapPhase } from "@/components/phase-roadmap";
import { StatusPill } from "@/components/ui/status";

const phases: RoadmapPhase[] = [
  {
    phase: "19",
    title: "Full shadow trading",
    status: "planned",
    summary: "Run the complete decision pipeline on live market data while recording simulated outcomes.",
    deliverables: ["Decision journal and simulated fills", "Backtest, paper, and shadow comparisons"]
  },
  {
    phase: "20",
    title: "Live Kite execution infrastructure",
    status: "planned",
    summary: "Broker writes require order management, reconciliation, recovery, and a fresh requirements review.",
    deliverables: ["Idempotent order manager", "Broker recovery and hard kill switch"]
  },
  {
    phase: "21",
    title: "Controlled live trading",
    status: "planned",
    summary: "Constrained live operation with small capital, strict limits, and actual-versus-expected monitoring.",
    deliverables: ["Limited symbols and risk", "Fill and slippage comparison"]
  }
];

export function ShadowLivePage() {
  return (
    <div className="space-y-5">
      <PhaseRoadmap title="Shadow & Live" description="Shadow validation, execution infrastructure, and controlled live operation." phases={phases} />
      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        <StatusPill label="Live orders locked" tone="danger" />
        <StatusPill label="Shadow not running" tone="warning" />
      </div>
    </div>
  );
}
