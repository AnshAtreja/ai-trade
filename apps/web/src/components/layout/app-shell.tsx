import { NavLink, Outlet } from "react-router-dom";
import {
  Activity,
  Bell,
  BrainCircuit,
  CandlestickChart,
  Crosshair,
  Gauge,
  LayoutDashboard,
  RadioTower,
  Shield,
  Sparkles,
  WalletCards,
  type LucideIcon
} from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusPill } from "@/components/ui/status";
import { Skeleton } from "@/components/ui/skeleton";
import { useKiteStatus, useMarketStreamStatus } from "@/api/queries";
import { useTradingStore } from "@/store/trading-store";

type NavItem = { to: string; label: string; icon: LucideIcon; end?: boolean };

const primaryNavItems: NavItem[] = [
  { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/broker", label: "Broker & Account", icon: RadioTower },
  { to: "/market", label: "Market", icon: CandlestickChart },
  { to: "/scanner", label: "Scanner", icon: Crosshair },
  { to: "/strategies", label: "Strategies", icon: Gauge },
  { to: "/paper", label: "Paper Trading", icon: WalletCards }
];

const researchNavItems: NavItem[] = [
  { to: "/backtesting", label: "Backtesting", icon: Activity },
  { to: "/intelligence", label: "Intelligence", icon: BrainCircuit }
];

const futureNavItems: NavItem[] = [
  { to: "/agent", label: "Agent & Decisions", icon: Sparkles },
  { to: "/alerts", label: "Alerts", icon: Bell },
  { to: "/shadow-live", label: "Shadow & Live", icon: Shield }
];

export function AppShell() {
  const { data: kiteStatus, isLoading: kiteStatusLoading } = useKiteStatus();
  const { data: streamStatus, isLoading: streamStatusLoading } = useMarketStreamStatus();
  const killSwitchArmed = useTradingStore((s) => s.killSwitchArmed);

  return (
    <div className="min-h-screen bg-console text-foreground">
      <div className="mx-auto flex min-h-screen max-w-[1600px]">
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-border bg-card/80 px-3 py-4 backdrop-blur lg:flex">
          <div className="mb-6 px-2">
            <div className="flex items-center gap-2 text-accent">
              <RadioTower className="h-4 w-4" />
              <span className="text-xs font-semibold uppercase tracking-[0.18em]">TradePilot</span>
            </div>
            <p className="mt-2 font-display text-xl text-foreground">AI Console</p>
            <p className="mt-1 text-xs text-muted">Paper-first · live orders locked</p>
          </div>
          <nav className="flex flex-1 flex-col gap-4 overflow-y-auto" aria-label="Primary navigation">
            <NavSection label="Operate" items={primaryNavItems} />
            <NavSection label="Research" items={researchNavItems} />
            <NavSection label="Later" items={futureNavItems} muted />
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 border-b border-border bg-card/90 px-4 py-3 backdrop-blur sm:px-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 lg:hidden">
                {primaryNavItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      cn(
                        "shrink-0 rounded-md border px-2 py-1 text-xs",
                        isActive ? "border-accent/40 bg-accent/10 text-foreground" : "border-border text-muted"
                      )
                    }
                  >
                    {item.label}
                  </NavLink>
                ))}
                <details className="relative shrink-0">
                  <summary className="cursor-pointer list-none rounded-md border border-border px-2 py-1 text-xs text-muted">More</summary>
                  <div className="absolute right-0 top-8 z-30 grid min-w-48 gap-1 rounded-md border border-border bg-card p-2 shadow-xl">
                    {[...researchNavItems, ...futureNavItems].map((item) => (
                      <NavLink key={item.to} to={item.to} end={item.end} className="rounded-md px-2 py-2 text-xs text-muted hover:bg-background hover:text-foreground">
                        {item.label}
                      </NavLink>
                    ))}
                  </div>
                </details>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {kiteStatusLoading ? (
                  <Skeleton className="h-7 w-28 rounded-full" />
                ) : (
                  <StatusPill
                    label={kiteStatus?.status === "CONNECTED" ? "Kite connected" : kiteStatus?.status === "VERIFYING" ? "Kite verifying" : "Kite login required"}
                    tone={kiteStatus?.status === "CONNECTED" ? "success" : "warning"}
                  />
                )}
                {streamStatusLoading ? (
                  <Skeleton className="h-7 w-24 rounded-full" />
                ) : (
                  <StatusPill
                    label={streamStatus?.connected ? "Stream connected" : streamStatus?.state === "CONNECTING" || streamStatus?.state === "RECONNECTING" ? "Stream connecting" : "REST only"}
                    tone={streamStatus?.connected ? "success" : streamStatus?.state === "CONNECTING" || streamStatus?.state === "RECONNECTING" ? "warning" : "info"}
                  />
                )}
                <StatusPill label="Paper enabled" tone="success" />
                <StatusPill
                  label={kiteStatus?.liveTradingDisabled === false ? "Live orders enabled" : "Live orders locked"}
                  tone={kiteStatus?.liveTradingDisabled === false ? "warning" : "danger"}
                />
                <StatusPill label={killSwitchArmed ? "Kill switch armed" : "Kill switch off"} tone={killSwitchArmed ? "danger" : "warning"} />
              </div>
            </div>
          </header>

          <main className="flex-1 px-4 py-4 sm:px-5 sm:py-5">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}

function NavSection({ label, items, muted = false }: { label: string; items: NavItem[]; muted?: boolean }) {
  return (
    <div className={cn(muted && "opacity-75")}>
      <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">{label}</div>
      <div className="grid gap-0.5">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors",
                isActive ? "bg-accent/15 text-foreground" : "text-muted hover:bg-background hover:text-foreground"
              )
            }
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {item.label}
          </NavLink>
        ))}
      </div>
    </div>
  );
}
