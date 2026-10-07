import { LockKeyhole, Play } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill, formatInr, toneClass } from "@/components/ui/status";
import { cn } from "@/lib/utils";
import type { SignalCardPayload } from "@/api/types";

type Direction = SignalCardPayload["direction"];

export function SignalCard({ signal }: { signal: SignalCardPayload }) {
  return (
    <Card className="flex min-h-[380px] flex-col">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="font-mono text-xl">{signal.symbol}</CardTitle>
            <div className="mt-2 space-y-2">
              <DirectionBadge direction={signal.direction} />
              <StatusPill label={signal.riskApproved ? "Risk Approved" : "Watch Only"} tone={signal.riskApproved ? "success" : "warning"} />
            </div>
          </div>
          <ScoreDial score={signal.score} direction={signal.direction} />
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          {signal.matchedSignals.map((matchedSignal) => (
            <Badge key={matchedSignal} className="border-border bg-background text-muted">
              {matchedSignal}
            </Badge>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm">
          <SignalMetric label="Entry trigger" value={formatInr(signal.entryTrigger)} />
          <SignalMetric label="Stop loss" value={formatInr(signal.stopLoss)} tone="danger" />
          <SignalMetric label="Target" value={formatInr(signal.target)} tone="success" />
          <SignalMetric label="Risk amount" value={formatInr(signal.riskAmount)} tone="warning" />
        </div>

        <p className="text-sm leading-6 text-muted">{signal.aiExplanation}</p>

        <div className="mt-auto grid gap-2 pt-2 md:grid-cols-2">
          <Button className="min-w-0 gap-2 whitespace-normal">
            <Play className="h-4 w-4 shrink-0" />
            Paper Trade
          </Button>
          <Button variant="outline" className="min-w-0 gap-2 whitespace-normal" disabled>
            <LockKeyhole className="h-4 w-4 shrink-0" />
            Approve Live Trade
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SignalMetric({
  label,
  value,
  tone = "info"
}: {
  label: string;
  value: string;
  tone?: "success" | "warning" | "danger" | "info";
}) {
  return (
    <div className="rounded-md border border-border bg-background/80 p-3">
      <div className="text-xs uppercase text-muted">{label}</div>
      <div className={cn("mt-1 font-mono font-semibold", toneClass(tone))}>{value}</div>
    </div>
  );
}

function ScoreDial({ score, direction }: { score: number; direction: Direction }) {
  return (
    <div
      className={cn(
        "flex h-16 w-16 flex-col items-center justify-center rounded-md border",
        direction === "BULLISH"
          ? "border-success/30 bg-success/10 text-success"
          : direction === "BEARISH"
            ? "border-danger/30 bg-danger/10 text-danger"
            : "border-warning/30 bg-warning/10 text-warning"
      )}
    >
      <span className="font-mono text-xl font-semibold">{score}</span>
      <span className="text-[10px] uppercase text-muted">score</span>
    </div>
  );
}

function DirectionBadge({ direction }: { direction: Direction }) {
  const tone = direction === "BULLISH" ? "success" : direction === "BEARISH" ? "danger" : "warning";
  return <StatusPill label={direction} tone={tone} />;
}
