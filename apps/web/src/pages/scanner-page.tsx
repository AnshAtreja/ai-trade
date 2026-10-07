import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Play, Radar, RefreshCw, Terminal } from "lucide-react";
import { apiPost } from "@/api/client";
import {
  useProductionScannerLatest,
  useProductionScannerStatus,
  useScannerSignalPipeline
} from "@/api/queries";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel } from "@/components/ui/page";
import { StatusPill } from "@/components/ui/status";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatGridSkeleton, TableSkeleton } from "@/components/ui/skeleton";

export function ScannerPage() {
  const queryClient = useQueryClient();
  const { data: status, error: statusError, isLoading: statusLoading } = useProductionScannerStatus();
  const { data: latest, error: latestError, isLoading } = useProductionScannerLatest();
  const { data: mockPipeline, isLoading: mockPipelineLoading } = useScannerSignalPipeline();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const candidates = latest?.candidates ?? [];

  async function runOnce() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await apiPost<{
        status: string;
        message?: string;
        stats?: { candidateCount?: number };
      }>("/api/scanner/run", { force: true });
      setMessage(
        result.message ??
          `Run ${result.status}${result.stats?.candidateCount != null ? ` · ${result.stats.candidateCount} candidates` : ""}`
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["scanner-status"] }),
        queryClient.invalidateQueries({ queryKey: ["scanner-signals-latest"] })
      ]);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Scanner run failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Scanner"
        description="Phase 5 production scanner: ranked candidates from live universe + latest market state. Not buy/sell signals."
        meta={<StatusPill label="Phase 5 · done" tone="success" />}
      />

      <Panel
        title="Production scanner status"
        icon={Radar}
        action={
          <Button size="sm" className="gap-2" disabled={busy} onClick={runOnce}>
            {busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Run once
          </Button>
        }
      >
        {statusError ? (
          <p className="text-sm text-warning">{(statusError as Error).message}</p>
        ) : statusLoading ? (
          <StatGridSkeleton />
        ) : status ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Mini label="Lifecycle" value={status.lifecycle} />
            <Mini label="Market session" value={status.marketSession} />
            <Mini label="Scheduler" value={status.schedulerRunning ? "running" : "stopped"} />
            <Mini
              label="Last run"
              value={
                status.lastRun
                  ? `${status.lastRun.status}${
                      status.lastRun.stats?.candidateCount != null
                        ? ` · ${status.lastRun.stats.candidateCount}`
                        : ""
                    }`
                  : "none"
              }
            />
          </div>
        ) : null}
        {message && <p className="mt-3 text-xs text-muted">{message}</p>}
        <p className="mt-3 text-xs text-muted">
          Manual run uses {"{ force: true }"} for diagnostics outside trading session. ATR/RSI-style factors remain
          Phase 8+.
        </p>
      </Panel>

      <Panel title="Latest candidates">
        {latestError ? (
          <p className="text-sm text-warning">{(latestError as Error).message}</p>
        ) : isLoading ? (
          <TableSkeleton columns={6} rows={6} />
        ) : candidates.length === 0 ? (
          <p className="text-sm text-muted">
            No candidates yet. Connect market stream, then Run once (or start the scanner scheduler).
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Direction</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                  <TableHead className="text-right">LTP</TableHead>
                  <TableHead>Stale</TableHead>
                  <TableHead>Reasons</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {candidates.map((row) => (
                  <TableRow key={`${row.instrumentToken}-${row.tradingSymbol}`}>
                    <TableCell className="font-mono font-semibold">{row.tradingSymbol}</TableCell>
                    <TableCell>
                      <StatusPill
                        label={row.direction}
                        tone={
                          row.direction === "BULLISH"
                            ? "success"
                            : row.direction === "BEARISH"
                              ? "danger"
                              : "info"
                        }
                      />
                    </TableCell>
                    <TableCell className="text-right font-mono">{row.score}</TableCell>
                    <TableCell className="text-right font-mono">{row.lastPrice}</TableCell>
                    <TableCell>
                      <StatusPill label={row.stale ? "stale" : "fresh"} tone={row.stale ? "warning" : "success"} />
                    </TableCell>
                    <TableCell className="max-w-md truncate text-xs text-muted">
                      {(row.reasons ?? []).slice(0, 3).join(" · ") || "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>

      {import.meta.env.DEV && mockPipelineLoading && <Panel title="Dev: legacy mock signal pipeline"><TableSkeleton columns={2} rows={3} /></Panel>}

      {import.meta.env.DEV && mockPipeline && (
        <Panel title="Dev: legacy mock signal pipeline" icon={Terminal}>
          <p className="mb-3 text-xs text-muted">
            Compatibility endpoint `/api/scanner/intraday/mock/signal-pipeline` — not the production scanner path.
          </p>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-xs leading-5 text-muted">
            {JSON.stringify(
              {
                signalCardCount: mockPipeline.signalCards.length,
                sample: mockPipeline.signalCards.slice(0, 3)
              },
              null,
              2
            )}
          </pre>
        </Panel>
      )}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-background/60 p-3">
      <div className="text-xs uppercase text-muted">{label}</div>
      <div className="mt-1 truncate font-mono text-sm font-semibold">{value}</div>
    </div>
  );
}
