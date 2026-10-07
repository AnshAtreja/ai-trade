import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { iconToneClass, toneClass, type Tone } from "@/components/ui/status";

export function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  tone = "info"
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  tone?: Tone;
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-3 pt-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
          <div className={cn("mt-1 font-mono text-2xl font-semibold", toneClass(tone))}>{value}</div>
          <div className="mt-1 text-xs text-muted">{detail}</div>
        </div>
        <div className={cn("flex h-10 w-10 items-center justify-center rounded-md border", iconToneClass(tone))}>
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}

export function PageHeader({
  title,
  description,
  meta
}: {
  title: string;
  description: string;
  meta?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="font-display text-2xl tracking-tight text-foreground">{title}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>
      </div>
      {meta ? <div className="flex flex-wrap items-center gap-2">{meta}</div> : null}
    </div>
  );
}

export function Panel({
  title,
  icon: Icon,
  children,
  action
}: {
  title: string;
  icon?: LucideIcon;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide">
          {Icon ? <Icon className="h-4 w-4 text-accent" /> : null}
          {title}
        </CardTitle>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
