import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export type Tone = "success" | "warning" | "danger" | "info";

export function StatusPill({ label, tone }: { label: string; tone: Tone }) {
  return <Badge className={cn("border px-2 py-1 text-[11px] uppercase", statusClass(tone))}>{label}</Badge>;
}

export function statusClass(tone: Tone) {
  return {
    success: "border-success/30 bg-success/10 text-success",
    warning: "border-warning/30 bg-warning/10 text-warning",
    danger: "border-danger/30 bg-danger/10 text-danger",
    info: "border-info/30 bg-info/10 text-info"
  }[tone];
}

export function toneClass(tone: Tone) {
  return {
    success: "text-success",
    warning: "text-warning",
    danger: "text-danger",
    info: "text-info"
  }[tone];
}

export function iconToneClass(tone: Tone) {
  return {
    success: "border-success/30 bg-success/10 text-success",
    warning: "border-warning/30 bg-warning/10 text-warning",
    danger: "border-danger/30 bg-danger/10 text-danger",
    info: "border-info/30 bg-info/10 text-info"
  }[tone];
}

export function formatInr(value: number) {
  return value.toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: value % 1 === 0 ? 0 : 2
  });
}
