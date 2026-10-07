import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, BarChart3, Database, RefreshCw } from "lucide-react";
import { apiFetch } from "@/api/client";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel } from "@/components/ui/page";
import { StatGridSkeleton, TableSkeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Freshness = { status: "AVAILABLE" | "UNAVAILABLE"; reason: string | null; observationTimestamp: string | null; ageMs: number | null };
type Regime = { trend: { state: string }; volatility: { state: string }; quality: string; relativeToMarket?: string };
type MarketPayload = { freshness: Freshness; market: { benchmark: { close: number | null; sessionReturn: { valuePct: number | null } }; breadth: { advancingCount: number; decliningCount: number; availableConstituents: number; expectedConstituents: number } } | null; regime: Regime | null };
type SectorPayload = { sectorId: string; freshness: Freshness; context: { breadth: { coveragePct: number } } | null; regime: Regime | null };
type HealthPayload = { featureSchemaVersion: string; contextUniverseId: string; regimeVersion: string; liveSessionPolicyVersion: string;
  authentication: { status: string; verified: boolean; reasonCode: string | null };
  cas: { status: string; contentHash: string | null; lastError: string | null; snapshotDate: string | null };
  stream: { state: string; lastMessageAt: string | null };
  benchmarkSubscriptions: { expected: number; active: number; missing: string[] };
  equitySubscriptions: { expected: number; active: number };
  instruments: { instrumentToken: string; tradingSymbol: string; sectorId: string }[];
  marketFreshness: Freshness; errors: { count: number; last: string | null } };
type InstrumentPayload = { freshness: Freshness; feature: { timestamp: string; values: Record<string, number | string | boolean | null>; quality: Record<string, string> } | null;
  context: { relative: { instrumentVsMarket: Record<string, { valuePct: number | null; quality: string }>; instrumentVsSector: Record<string, { valuePct: number | null; quality: string }> } } | null;
  marketRegime: Regime | null };

function pct(value: number | null | undefined) { return value == null ? "Unavailable" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`; }
function time(value: string | null | undefined) { return value ? new Date(value).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "Unavailable"; }
function tone(value: string | null | undefined): "success" | "warning" | "danger" { return value === "AVAILABLE" ? "success" : value === "UNAVAILABLE" || value === "AUTH_REQUIRED" ? "danger" : "warning"; }
function statusText(value: string | null | undefined) { return value ? value.replace(/_/g, " ").toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase()) : ""; }

export function IntelligencePage() {
  const [token, setToken] = useState("");
  const health = useQuery({ queryKey: ["intelligence-health"], queryFn: () => apiFetch<HealthPayload>("/api/market-intelligence/health"), refetchInterval: 15_000, retry: false });
  const market = useQuery({ queryKey: ["intelligence-market"], queryFn: () => apiFetch<MarketPayload>("/api/market-intelligence/market"), refetchInterval: 15_000, retry: false });
  const sectors = useQuery({ queryKey: ["intelligence-sectors"], queryFn: () => apiFetch<{ sectors: SectorPayload[] }>("/api/market-intelligence/sectors"), refetchInterval: 15_000, retry: false });
  const selectedToken = token || health.data?.instruments[0]?.instrumentToken || "";
  const instrument = useQuery({ queryKey: ["intelligence-instrument", selectedToken], queryFn: () => apiFetch<InstrumentPayload>(`/api/market-intelligence/instruments/${selectedToken}`), enabled: Boolean(selectedToken), refetchInterval: 15_000, retry: false });
  const error = health.error || market.error || sectors.error || instrument.error;
  return <div className="space-y-4">
    <PageHeader title="Market Intelligence" description="Live market, sector, and instrument context" meta={<StatusPill label={health.data?.marketFreshness.status ?? "LOADING"} tone={tone(health.data?.marketFreshness.status)} />} />
    <div className="border-l-2 border-warning px-3 py-2 text-sm text-muted">
      <span className="font-semibold text-foreground">Phase 9 gate:</span> 9A–9D are complete. 9E remains open until the current-day NSE CAS source and a real active-session feed are verified. This page observes context only; it does not change strategies or place orders.
    </div>
    {error && <div role="alert" className="border-l-2 border-danger px-3 py-2 text-sm text-danger">{(error as Error).message}</div>}
    <Panel title="Market" icon={BarChart3}>
      {market.isLoading ? <StatGridSkeleton count={5} /> : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Metric label="Regime" value={statusText(market.data?.regime?.trend.state) || "Unavailable"} detail={statusText(market.data?.freshness.reason)} />
        <Metric label="Volatility" value={market.data?.regime?.volatility.state ?? "Unavailable"} />
        <Metric label="NIFTY 50" value={market.data?.market?.benchmark.close?.toLocaleString("en-IN") ?? "Unavailable"} detail={pct(market.data?.market?.benchmark.sessionReturn.valuePct)} />
        <Metric label="25-stock breadth" value={market.data?.market ? `${market.data.market.breadth.advancingCount} up / ${market.data.market.breadth.decliningCount} down` : "Unavailable"} detail={market.data?.market ? `${market.data.market.breadth.availableConstituents}/${market.data.market.breadth.expectedConstituents} observed` : ""} />
        <Metric label="As of" value={time(market.data?.freshness.observationTimestamp)} detail={statusText(market.data?.freshness.reason ?? market.data?.regime?.quality)} />
      </div>}
    </Panel>
    <Panel title="Sectors" icon={Activity}>
      {sectors.isLoading ? <TableSkeleton columns={4} rows={8} /> : <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Sector</TableHead><TableHead>Regime</TableHead><TableHead>Relative</TableHead><TableHead>Sample breadth</TableHead><TableHead>Quality</TableHead></TableRow></TableHeader>
        <TableBody>{sectors.data?.sectors.map((sector) => <TableRow key={sector.sectorId}>
          <TableCell className="font-medium">{sector.sectorId.replace(/_/g, " ")}</TableCell>
          <TableCell>{sector.regime?.trend.state ?? "Unavailable"}</TableCell>
          <TableCell>{sector.regime?.relativeToMarket ?? "Unavailable"}</TableCell>
          <TableCell>{sector.context ? `${sector.context.breadth.coveragePct.toFixed(0)}%` : "Unavailable"}</TableCell>
          <TableCell><StatusPill label={statusText(sector.freshness.reason ?? sector.regime?.quality ?? sector.freshness.status)} tone={tone(sector.freshness.reason ?? sector.regime?.quality ?? sector.freshness.status)} /></TableCell>
        </TableRow>)}</TableBody></Table></div>}
    </Panel>
    <Panel title="Instrument" icon={Activity} action={<select aria-label="Research-sample instrument" value={selectedToken} onChange={(event) => setToken(event.target.value)} className="max-w-44 rounded-md border border-border bg-background px-2 py-1 text-sm">
      {health.data?.instruments.map((item) => <option key={item.instrumentToken} value={item.instrumentToken}>{item.tradingSymbol}</option>)}
    </select>}>
      {instrument.isLoading ? <StatGridSkeleton count={6} /> : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Metric label="Last close" value={instrument.data?.feature?.values.lastPrice?.toLocaleString() ?? "Unavailable"} detail={time(instrument.data?.feature?.timestamp)} />
        <Metric label="VWAP" value={instrument.data?.feature?.values.sessionVwap?.toLocaleString() ?? "Unavailable"} detail={instrument.data?.feature?.quality.sessionVwap ?? ""} />
        <Metric label="ATR" value={instrument.data?.feature?.values.atr?.toLocaleString() ?? "Unavailable"} detail={instrument.data?.feature?.quality.atr ?? ""} />
        <Metric label="Market-relative 15m" value={pct(instrument.data?.context?.relative.instrumentVsMarket["15m"]?.valuePct)} detail={instrument.data?.context?.relative.instrumentVsMarket["15m"]?.quality ?? ""} />
        <Metric label="Sector-relative 15m" value={pct(instrument.data?.context?.relative.instrumentVsSector["15m"]?.valuePct)} detail={instrument.data?.context?.relative.instrumentVsSector["15m"]?.quality ?? ""} />
        <Metric label="Context" value={statusText(instrument.data?.freshness.status) || "Unavailable"} detail={statusText(instrument.data?.freshness.reason ?? instrument.data?.marketRegime?.quality)} />
      </div>}
    </Panel>
    <Panel title="Health" icon={Database} action={<Button size="sm" variant="outline" title="Refresh intelligence" onClick={() => { void health.refetch(); void market.refetch(); void sectors.refetch(); void instrument.refetch(); }}><RefreshCw className="h-4 w-4" /></Button>}>
      {health.isLoading ? <StatGridSkeleton count={6} /> : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Metric label="Market stream" value={health.data?.stream.state ?? "Unavailable"} detail={`Last tick ${time(health.data?.stream.lastMessageAt)}`} />
        <Metric label="Kite authentication" value={statusText(health.data?.authentication.status) || "Unavailable"} detail={statusText(health.data?.authentication.reasonCode)} />
        <Metric label="Benchmarks" value={`${health.data?.benchmarkSubscriptions.active ?? 0}/${health.data?.benchmarkSubscriptions.expected ?? 8} active`} detail={health.data?.benchmarkSubscriptions.missing.length ? "Missing subscriptions" : ""} />
        <Metric label="Research equities" value={`${health.data?.equitySubscriptions.active ?? 0}/${health.data?.equitySubscriptions.expected ?? 25} active`} />
        <Metric label="Live CAS policy" value={statusText(health.data?.cas.status) || "Unknown"} detail={health.data?.cas.lastError ?? health.data?.cas.snapshotDate ?? ""} />
        <Metric label="Observation age" value={health.data?.marketFreshness.ageMs == null ? "Unavailable" : `${Math.max(0, Math.round(health.data.marketFreshness.ageMs / 1000))}s`} detail={statusText(health.data?.marketFreshness.reason)} />
        <Metric label="Engine errors" value={String(health.data?.errors.count ?? 0)} detail={health.data?.errors.last ?? ""} />
      </div>}
      <div className="mt-4 break-all border-t border-border pt-3 font-mono text-xs text-muted">{health.data && `${health.data.featureSchemaVersion} · ${health.data.contextUniverseId} · ${health.data.regimeVersion} · ${health.data.liveSessionPolicyVersion} · ${health.data.cas.contentHash ?? "CAS UNKNOWN"}`}</div>
    </Panel>
  </div>;
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className="min-w-0 border-l-2 border-border pl-3"><div className="text-xs text-muted">{label}</div><div className="mt-1 break-words text-sm font-semibold text-foreground">{value}</div>{detail && <div className="mt-1 break-words text-xs text-muted">{detail}</div>}</div>;
}
