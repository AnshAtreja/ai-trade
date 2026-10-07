import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Gauge, Play, RefreshCw } from "lucide-react";
import { apiPost } from "@/api/client";
import {
  useStrategies,
  useStrategySignalsLatest,
  useStrategySignalsPersisted,
  useStrategyStatus
} from "@/api/queries";
import type { StrategyEvaluationPayload } from "@/api/types";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel } from "@/components/ui/page";
import { StatusPill } from "@/components/ui/status";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { StatGridSkeleton, TableSkeleton } from "@/components/ui/skeleton";

export function StrategiesPage() {
  const queryClient = useQueryClient();
  const { data: list, error: listError, isLoading: listLoading } = useStrategies();
  const { data: status, error: statusError, isLoading: statusLoading } = useStrategyStatus();
  const { data: latest, error: latestError, isLoading: latestLoading } = useStrategySignalsLatest();
  const { data: persisted, error: persistedError, isLoading: persistedLoading } = useStrategySignalsPersisted();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [selected, setSelected] = useState<StrategyEvaluationPayload | null>(null);

  const strategies = list?.strategies ?? [];
  const setups = latest?.setups ?? [];
  const history = persisted?.setups ?? [];

  async function evaluate() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await apiPost<{
        setupCount: number;
        evaluationCount: number;
        marketSession: string;
        message?: string;
      }>("/api/strategies/evaluate", { force: true });
      setMessage(
        `Evaluated ${result.evaluationCount} results · ${result.setupCount} setups · session ${result.marketSession}`
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["strategies-status"] }),
        queryClient.invalidateQueries({ queryKey: ["strategies-signals-latest"] }),
        queryClient.invalidateQueries({ queryKey: ["strategies-signals"] })
      ]);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Evaluate failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Strategies"
        description="Deterministic Phase 6 strategy engine. Setups are analytical outputs — not orders."
        meta={<StatusPill label="Phase 6 · done" tone="success" />}
      />

      <Panel
        title="Engine status"
        icon={Gauge}
        action={
          <Button size="sm" className="gap-2" disabled={busy} onClick={evaluate}>
            {busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Evaluate now
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
            <Mini label="Enabled" value={status.enabledStrategyIds.join(", ") || "none"} />
          </div>
        ) : null}
        {message && <p className="mt-3 text-xs text-muted">{message}</p>}
        <p className="mt-3 text-xs text-muted">
          Uses scanner candidates when available. Manual evaluate uses {"{ force: true }"} so closed-session skips
          do not block diagnostics.
        </p>
      </Panel>

      <Panel title="Registered strategies">
        {listError ? (
          <p className="text-sm text-warning">{(listError as Error).message}</p>
        ) : listLoading ? (
          <TableSkeleton columns={5} rows={4} />
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead>Sessions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {strategies.map((strategy) => (
                  <TableRow key={strategy.id}>
                    <TableCell className="font-mono text-xs">{strategy.id}</TableCell>
                    <TableCell className="font-semibold">{strategy.name}</TableCell>
                    <TableCell className="font-mono">v{strategy.version}</TableCell>
                    <TableCell>
                      <StatusPill
                        label={strategy.enabled ? "enabled" : "disabled"}
                        tone={strategy.enabled ? "success" : "warning"}
                      />
                    </TableCell>
                    <TableCell className="text-xs text-muted">{strategy.allowedSessions.join(", ")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>

      <Panel title="Latest detected setups">
        {latestError ? (
          <p className="text-sm text-warning">{(latestError as Error).message}</p>
        ) : latestLoading ? (
          <TableSkeleton columns={8} rows={5} />
        ) : setups.length === 0 ? (
          <p className="text-sm text-muted">
            No SETUP_DETECTED results yet. Run the scanner, then Evaluate (or start the strategy scheduler).
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Strategy</TableHead>
                  <TableHead>Direction</TableHead>
                  <TableHead className="text-right">Entry</TableHead>
                  <TableHead className="text-right">Stop</TableHead>
                  <TableHead className="text-right">Target</TableHead>
                  <TableHead className="text-right">R:R</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {setups.map((setup) => (
                  <TableRow key={setup.setupIdentity}>
                    <TableCell className="font-mono font-semibold">{setup.tradingSymbol}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {setup.strategyId}:v{setup.strategyVersion}
                    </TableCell>
                    <TableCell>
                      <StatusPill
                        label={setup.direction}
                        tone={
                          setup.direction === "BULLISH"
                            ? "success"
                            : setup.direction === "BEARISH"
                              ? "danger"
                              : "info"
                        }
                      />
                    </TableCell>
                    <TableCell className="text-right font-mono">{setup.entry?.price ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono">{setup.stopLoss ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono">{setup.target ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono">{setup.rewardRisk ?? "—"}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={() => setSelected(setup)}>
                        Details
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>

      {selected && (
        <Panel
          title={`${selected.tradingSymbol} · ${selected.strategyId}:v${selected.strategyVersion}`}
          action={
            <Button size="sm" variant="outline" onClick={() => setSelected(null)}>
              Close
            </Button>
          }
        >
          <div className="space-y-3 text-sm">
            <p className="text-muted">
              Status <span className="text-foreground">{selected.status}</span> · confidence{" "}
              {selected.confidence ?? "—"} · session {selected.marketSession}
            </p>
            <div>
              <div className="mb-1 text-xs uppercase text-muted">Reasons</div>
              <ul className="list-disc space-y-1 pl-5">
                {selected.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
            <div>
              <div className="mb-1 text-xs uppercase text-muted">Conditions</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {selected.conditions.map((condition) => (
                  <div
                    key={condition.name}
                    className={cn(
                      "rounded-md border px-3 py-2 font-mono text-xs",
                      condition.passed ? "border-success/30 text-success" : "border-border text-muted"
                    )}
                  >
                    {condition.passed ? "PASS" : "FAIL"} · {condition.name}
                    {condition.detail ? ` · ${condition.detail}` : ""}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Panel>
      )}

      <Panel title="Persisted strategy setups">
        {persistedError ? (
          <p className="text-sm text-warning">{(persistedError as Error).message}</p>
        ) : persistedLoading ? (
          <TableSkeleton columns={5} rows={5} />
        ) : history.length === 0 ? (
          <p className="text-sm text-muted">No historical StrategySetup rows yet (only SETUP_DETECTED is persisted).</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Strategy</TableHead>
                  <TableHead>Direction</TableHead>
                  <TableHead className="text-right">R:R</TableHead>
                  <TableHead>Captured</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.slice(0, 30).map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono font-semibold">{row.symbol}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.strategyId}:v{row.strategyVersion}
                    </TableCell>
                    <TableCell>{row.direction}</TableCell>
                    <TableCell className="text-right font-mono">{row.rewardRisk}</TableCell>
                    <TableCell className="font-mono text-xs text-muted">
                      {new Date(row.capturedAt).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>
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
