import { PageHeader } from "@/components/ui/page";
import { StatusPill } from "@/components/ui/status";

export interface RoadmapPhase {
  phase: string;
  title: string;
  status: "done" | "active" | "blocked" | "planned";
  summary: string;
  deliverables: string[];
}

export function PhaseRoadmap({
  title,
  description,
  phases
}: {
  title: string;
  description: string;
  phases: RoadmapPhase[];
}) {
  const overallStatus = phases.some((phase) => phase.status === "blocked")
    ? { label: "Blocked", tone: "warning" as const }
    : phases.some((phase) => phase.status === "active")
      ? { label: "In progress", tone: "info" as const }
      : phases.every((phase) => phase.status === "done")
        ? { label: "Complete", tone: "success" as const }
        : { label: "Planned", tone: "info" as const };
  return (
    <div className="space-y-2">
      <PageHeader
        title={title}
        description={description}
        meta={<StatusPill label={overallStatus.label} tone={overallStatus.tone} />}
      />
      <div className="divide-y divide-border">
        {phases.map((phase) => (
          <section key={phase.phase} className="grid gap-3 py-5 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] md:gap-8">
            <div className="flex items-start gap-3">
              <span className="min-w-10 pt-0.5 font-mono text-sm font-semibold text-accent">{phase.phase}</span>
              <StatusPill label={phaseStatusLabel(phase.status)} tone={phaseStatusTone(phase.status)} />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-foreground">{phase.title}</h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">{phase.summary}</p>
              <ul className="mt-3 grid gap-x-8 gap-y-1 text-sm text-foreground sm:grid-cols-2">
                {phase.deliverables.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function phaseStatusLabel(status: RoadmapPhase["status"]) {
  return { done: "Complete", active: "In progress", blocked: "Blocked", planned: "Planned" }[status];
}

function phaseStatusTone(status: RoadmapPhase["status"]) {
  return { done: "success", active: "info", blocked: "warning", planned: "info" }[status] as "success" | "warning" | "info";
}
