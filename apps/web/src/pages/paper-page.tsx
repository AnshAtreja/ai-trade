import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { apiPost } from "@/api/client";
import { usePaperAccount, usePaperExecutionStatus, usePaperOrders, usePaperTrades } from "@/api/queries";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel } from "@/components/ui/page";
import { StatusPill, formatInr, toneClass } from "@/components/ui/status";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { StatGridSkeleton, TableSkeleton } from "@/components/ui/skeleton";

export function PaperPage() {
  const { data: account, error: accountError, isLoading: accountLoading, refetch: refetchAccount } = usePaperAccount();
  const { data: trades, error: tradesError, isLoading: tradesLoading } = usePaperTrades();
  const { data: orders, error: ordersError, isLoading: ordersLoading } = usePaperOrders();
  const { data: execution, error: executionError, isLoading: executionLoading } = usePaperExecutionStatus();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setBusy(true);
    setMessage(null);
    try {
      await apiPost("/api/paper-trading/account/refresh");
      setMessage("Paper account refreshed.");
      await queryClient.invalidateQueries({ queryKey: ["paper-account"] });
      await refetchAccount();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Refresh failed.");
    } finally {
      setBusy(false);
    }
  }

  async function reconcile() {
    setBusy(true);
    setMessage(null);
    try {
      await apiPost("/api/paper-trading/execution/reconcile");
      setMessage("Paper execution reconciled.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["paper-execution-status"] }),
        queryClient.invalidateQueries({ queryKey: ["paper-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["paper-trades"] }),
        queryClient.invalidateQueries({ queryKey: ["paper-account"] })
      ]);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Reconcile failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Paper Trading"
        description="Virtual capital with Phase 7 realistic fills (slippage, latency, stops). Never places live Kite orders."
        meta={<StatusPill label="Phases 1 · 7 · done" tone="success" />}
      />

      <Panel
        title="Paper AccountState"
        action={
          <Button size="sm" variant="outline" className="gap-2" disabled={busy} onClick={refresh}>
            <RefreshCw className={busy ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            Refresh
          </Button>
        }
      >
        {accountError && !account ? (
          <p className="text-sm text-warning">{(accountError as Error).message}</p>
        ) : accountLoading ? (
          <StatGridSkeleton count={8} />
        ) : account ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Mini label="Equity" value={formatInr(account.currentEquity)} />
            <Mini label="Available" value={formatInr(account.availableCapital)} />
            <Mini
              label="Day P&L"
              value={formatInr(account.dayPnl)}
              className={toneClass(account.dayPnl < 0 ? "danger" : "success")}
            />
            <Mini label="Risk remaining" value={formatInr(account.riskRemainingToday)} />
            <Mini label="Open positions" value={String(account.openPositions)} />
            <Mini label="Trades today" value={String(account.tradesToday)} />
            <Mini label="Status" value={account.status} />
            <Mini label="Starting capital" value={formatInr(account.startingCapital)} />
          </div>
        ) : null}
        {message && <p className="mt-3 text-xs text-muted">{message}</p>}
      </Panel>

      <Panel
        title="Execution provider (Phase 7)"
        action={
          <Button size="sm" variant="outline" disabled={busy} onClick={reconcile}>
            Reconcile
          </Button>
        }
      >
        {executionError ? (
          <p className="text-sm text-warning">{(executionError as Error).message}</p>
        ) : executionLoading ? (
          <StatGridSkeleton count={6} />
        ) : execution ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Mini label="Provider" value={execution.provider} />
            <Mini label="Live Kite orders" value={execution.liveKiteOrders ? "ENABLED" : "disabled"} />
            <Mini label="Auto paper exec" value={execution.autoPaperExecution ? "on" : "off"} />
            <Mini label="Reconciler" value={execution.reconcilerRunning ? "running" : "stopped"} />
            <Mini label="Market session" value={execution.marketSession} />
            <Mini label="Busy" value={execution.busy ? "yes" : "no"} />
          </div>
        ) : null}
        <p className="mt-3 text-xs text-muted">
          Auto execution from strategy setups stays gated (`PAPER_AUTO_EXECUTION`). Live broker order placement remains
          disabled.
        </p>
      </Panel>

      <Panel title="Paper orders">
        {ordersError ? (
          <p className="text-sm text-warning">{(ordersError as Error).message}</p>
        ) : ordersLoading ? (
          <TableSkeleton columns={7} rows={6} />
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Purpose</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Filled</TableHead>
                  <TableHead className="text-right">Avg fill</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(orders ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-muted">
                      No paper orders yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  (orders ?? []).slice(0, 25).map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono font-semibold">{row.symbol}</TableCell>
                      <TableCell>{row.side}</TableCell>
                      <TableCell>
                        <StatusPill label={row.status} tone={orderTone(row.status)} />
                      </TableCell>
                      <TableCell className="text-xs text-muted">{row.purpose}</TableCell>
                      <TableCell className="text-right font-mono">{row.quantity}</TableCell>
                      <TableCell className="text-right font-mono">{row.filledQuantity}</TableCell>
                      <TableCell className="text-right font-mono">
                        {row.averageFillPrice == null ? "—" : row.averageFillPrice}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>

      <Panel title="Paper trades">
        {tradesError ? (
          <p className="text-sm text-warning">{(tradesError as Error).message}</p>
        ) : tradesLoading ? (
          <TableSkeleton columns={6} rows={6} />
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">P&L</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(trades ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-muted">
                      No paper trades yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  (trades ?? []).slice(0, 25).map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono text-xs text-muted">{row.id}</TableCell>
                      <TableCell className="font-mono font-semibold">{row.symbol}</TableCell>
                      <TableCell>{row.side}</TableCell>
                      <TableCell>
                        <StatusPill
                          label={row.status}
                          tone={row.status === "OPEN" ? "success" : row.status === "CLOSED" ? "info" : "warning"}
                        />
                      </TableCell>
                      <TableCell className="text-right font-mono">{row.quantity}</TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-mono font-semibold",
                          (row.pnl ?? 0) > 0 ? "text-success" : "text-muted"
                        )}
                      >
                        {row.pnl == null ? "—" : formatInr(row.pnl)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function orderTone(status: string): "success" | "info" | "warning" | "danger" {
  if (status === "FILLED" || status === "COMPLETE") return "success";
  if (status === "REJECTED" || status === "CANCELLED") return "danger";
  if (status === "PARTIAL" || status === "OPEN" || status === "PENDING") return "warning";
  return "info";
}

function Mini({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="rounded-md border border-border bg-background/60 p-3">
      <div className="text-xs uppercase text-muted">{label}</div>
      <div className={cn("mt-1 font-mono text-lg font-semibold", className)}>{value}</div>
    </div>
  );
}
