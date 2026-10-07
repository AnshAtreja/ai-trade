import { Ban, Power, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status";
import { cn } from "@/lib/utils";
import { useTradingStore } from "@/store/trading-store";

export function KillSwitchCard() {
  const armed = useTradingStore((s) => s.killSwitchArmed);
  const toggle = useTradingStore((s) => s.toggleKillSwitch);

  return (
    <Card className={cn("border-danger/40", armed && "bg-danger/10")}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <Power className="h-4 w-4 text-danger" />
            Kill Switch
          </CardTitle>
          <StatusPill label={armed ? "Armed" : "Off"} tone={armed ? "danger" : "warning"} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 text-sm">
          <div className="flex items-center justify-between border-b border-border pb-2">
            <span className="text-muted">Live order placement</span>
            <span className="font-semibold text-danger">Disabled</span>
          </div>
          <div className="flex items-center justify-between border-b border-border pb-2">
            <span className="text-muted">Paper trading</span>
            <span className="font-semibold text-success">Allowed</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted">Broker adapter guard</span>
            <span className="font-semibold">Always on</span>
          </div>
        </div>
        <Button variant={armed ? "outline" : "default"} className="w-full gap-2" onClick={toggle}>
          {armed ? <Ban className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
          {armed ? "Disarm Dashboard Switch" : "Arm Dashboard Switch"}
        </Button>
      </CardContent>
    </Card>
  );
}
