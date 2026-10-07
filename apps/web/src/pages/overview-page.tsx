import { Activity, ArrowRight, BrainCircuit, CheckCircle2, RadioTower, ShieldAlert, WalletCards } from "lucide-react";
import { Link } from "react-router-dom";
import { MetricCard, PageHeader, Panel } from "@/components/ui/page";
import { StatusPill, formatInr, toneClass } from "@/components/ui/status";
import { KillSwitchCard } from "@/features/overview/kill-switch-card";
import { useKiteStatus, useMarketStreamStatus, usePaperAccount } from "@/api/queries";
import { cn } from "@/lib/utils";
import { MetricCardSkeleton, StatGridSkeleton } from "@/components/ui/skeleton";

export function OverviewPage() {
  const { data: kiteStatus, isLoading: kiteStatusLoading } = useKiteStatus();
  const { data: streamStatus, isLoading: streamStatusLoading } = useMarketStreamStatus();
  const { data: paperAccount, isError: paperError, isLoading: paperAccountLoading } = usePaperAccount();

  return (
    <div className="space-y-4">
      <PageHeader
        title="TradePilot control center"
        description="Follow the operating flow from broker connection to market observation, paper trading, and research."
        meta={<StatusPill label="Phase 9 paused" tone="warning" />}
      />

      <Panel title="Recommended flow" icon={ArrowRight}>
        <p className="mb-4 max-w-3xl text-sm text-muted">Complete these steps in order when you are operating the system. The current setup is observation-first: paper execution is available, while live orders stay locked.</p>
        <div className="grid gap-2 lg:grid-cols-4">
          <FlowStep number="1" title="Connect Kite" detail={kiteStatus?.status === "CONNECTED" ? "Session verified" : "Login required"} to="/broker" ready={kiteStatus?.status === "CONNECTED"} />
          <FlowStep number="2" title="Start market data" detail={streamStatus?.connected ? "Stream connected" : "REST only"} to="/market" ready={streamStatus?.connected} />
          <FlowStep number="3" title="Inspect paper path" detail="Virtual money only" to="/paper" ready />
          <FlowStep number="4" title="Review research" detail="CLI artifacts, no web run" to="/backtesting" ready />
        </div>
      </Panel>

      <div className="grid gap-3 xl:grid-cols-[1.2fr,0.8fr]">
        <Panel title="Current gate" icon={BrainCircuit}>
          <div className="border-l-2 border-warning pl-3">
            <div className="font-semibold text-foreground">Phase 9 is open, not closed</div>
            <p className="mt-1 text-sm leading-6 text-muted">The intelligence foundation and historical validation are complete. Live closure is waiting for a verified current-day NSE CM/MII CAS source and a real market-session feed check. No intelligence feature can place orders or change strategy filters.</p>
          </div>
        </Panel>
        <Panel title="Safety boundary" icon={ShieldAlert}>
          <div className="space-y-2 text-sm text-muted">
            <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-success" /> Paper trading is virtual.</div>
            <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-success" /> Live Kite orders are locked.</div>
            <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-success" /> Intelligence is observational only.</div>
          </div>
        </Panel>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kiteStatusLoading ? <MetricCardSkeleton /> : <MetricCard icon={RadioTower} label="Kite connection" value={kiteStatus?.status === "CONNECTED" ? "CONNECTED" : "LOGIN REQUIRED"} detail={kiteStatus?.user?.userName ?? kiteStatus?.reason ?? "Read-only session not verified"} tone={kiteStatus?.status === "CONNECTED" ? "success" : "warning"} />}
        {streamStatusLoading ? <MetricCardSkeleton /> : <MetricCard icon={Activity} label="Market stream" value={streamStatus?.connected ? "CONNECTED" : streamStatus?.state ?? "REST ONLY"} detail={streamStatus ? `${streamStatus.subscriptionCount} subs · ${streamStatus.source}` : "Stream status unavailable"} tone={streamStatus?.connected ? "success" : "info"} />}
        {paperAccountLoading ? <MetricCardSkeleton /> : <MetricCard icon={WalletCards} label="Paper equity" value={paperAccount ? formatInr(paperAccount.currentEquity) : paperError ? "—" : "—"} detail={paperAccount ? `Day P&L ${formatInr(paperAccount.dayPnl)}` : "Initialize via paper trades"} tone={paperAccount && paperAccount.dayPnl < 0 ? "danger" : "success"} />}
        {kiteStatusLoading ? <MetricCardSkeleton /> : <MetricCard icon={ShieldAlert} label="Live orders" value={kiteStatus?.liveTradingDisabled === false ? "ENABLED" : "LOCKED"} detail="Orders remain blocked in adapter" tone="danger" />}
      </section>

      <section className="grid gap-3 xl:grid-cols-[1.2fr,0.8fr]">
        <Panel title="Today’s paper risk">
          {paperAccountLoading ? <StatGridSkeleton count={6} /> : paperAccount ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Stat label="Available capital" value={formatInr(paperAccount.availableCapital)} />
              <Stat label="Used capital" value={formatInr(paperAccount.usedCapital)} />
              <Stat label="Risk remaining" value={formatInr(paperAccount.riskRemainingToday)} />
              <Stat label="Open positions" value={String(paperAccount.openPositions)} />
              <Stat
                label="Account status"
                value={paperAccount.status}
                tone={paperAccount.status === "ACTIVE" ? "success" : "danger"}
              />
              <Stat label="Trades today" value={String(paperAccount.tradesToday)} />
            </div>
          ) : (
            <p className="text-sm text-muted">
              No paper account view yet. Open a paper trade or call account refresh — see{" "}
              <Link className="text-accent underline" to="/paper">
                Paper Trading
              </Link>
              .
            </p>
          )}
        </Panel>
        <KillSwitchCard />
      </section>

      <Panel title="Where to go next">
        <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <QuickLink to="/broker" label="Connect Kite & refresh account" />
          <QuickLink to="/market" label="Universe + stream health" />
          <QuickLink to="/scanner" label="Scanner candidates" />
        </div>
      </Panel>
    </div>
  );
}

function Stat({ label, value, tone = "info" }: { label: string; value: string; tone?: "success" | "warning" | "danger" | "info" }) {
  return (
    <div className="rounded-md border border-border bg-background/60 p-3">
      <div className="text-xs uppercase text-muted">{label}</div>
      <div className={cn("mt-1 font-mono text-lg font-semibold", toneClass(tone))}>{value}</div>
    </div>
  );
}

function QuickLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="rounded-md border border-border bg-background/50 px-3 py-3 text-muted transition hover:border-accent/40 hover:text-foreground">
      {label}
    </Link>
  );
}

function FlowStep({ number, title, detail, to, ready }: { number: string; title: string; detail: string; to: string; ready?: boolean }) {
  return (
    <Link to={to} className="group rounded-md border border-border bg-background/50 p-3 transition hover:border-accent/50 hover:bg-accent/5">
      <div className="flex items-start justify-between gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full border border-accent/40 font-mono text-xs text-accent">{number}</span>
        <StatusPill label={ready ? "Ready" : "Action"} tone={ready ? "success" : "warning"} />
      </div>
      <div className="mt-3 text-sm font-semibold text-foreground">{title}</div>
      <div className="mt-1 text-xs text-muted">{detail}</div>
    </Link>
  );
}
