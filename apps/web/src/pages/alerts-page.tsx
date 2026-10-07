import { PhaseRoadmap } from "@/components/phase-roadmap";

export function AlertsPage() {
  return (
    <PhaseRoadmap
      title="Alerts"
      description="Operational visibility and authorized controls."
      phases={[
        {
          phase: "18",
          title: "Telegram control plane",
          status: "planned",
          summary: "Decision, risk, portfolio, and system-health notifications with audited operator commands.",
          deliverables: ["Candidate and decision alerts", "Authorized status, pause, resume, and kill commands"]
        }
      ]}
    />
  );
}
