import { PhaseRoadmap, type RoadmapPhase } from "@/components/phase-roadmap";

const phases: RoadmapPhase[] = [
  {
    phase: "13",
    title: "Portfolio allocation",
    status: "planned",
    summary: "Candidates compete for shared capital and risk budgets.",
    deliverables: ["Sector and direction exposure", "Deterministic quantity proposals"]
  },
  {
    phase: "14",
    title: "Adaptive risk",
    status: "planned",
    summary: "Risk scales with market and portfolio stress while hard limits remain authoritative.",
    deliverables: ["Volatility and drawdown controls", "Auditable kill conditions"]
  },
  {
    phase: "15",
    title: "Execution intelligence",
    status: "planned",
    summary: "Expected costs and liquidity determine whether a valid setup is worth trading.",
    deliverables: ["Spread and slippage estimates", "Gross-edge versus net-edge checks"]
  },
  {
    phase: "16",
    title: "Unified decision engine",
    status: "planned",
    summary: "A deterministic gate combines approved inputs into an explainable decision.",
    deliverables: ["Approve, reduce, or skip", "Reason chain and hard risk gates"]
  },
  {
    phase: "17",
    title: "LLM and MCP reasoning",
    status: "planned",
    summary: "An agent explains decisions and supports research from structured facts.",
    deliverables: ["Read-only research tools", "Cited diagnostics and decision explanations"]
  }
];

export function AgentPage() {
  return <PhaseRoadmap title="Agent & Decisions" description="Allocation, risk, execution cost, deterministic decisions, and explanation." phases={phases} />;
}
