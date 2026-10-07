import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel } from "@/components/ui/page";
import { StatusPill, formatInr } from "@/components/ui/status";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KiteConnectionPanel } from "@/features/broker/kite-connection-panel";
import { apiPost } from "@/api/client";
import { useKiteAccount, useKiteLtp, useKiteStatus } from "@/api/queries";
import { useState } from "react";
import { StatGridSkeleton, TableSkeleton } from "@/components/ui/skeleton";

export function BrokerPage() {
  const { data: kiteStatus, isLoading: kiteStatusLoading } = useKiteStatus();
  const { data: kiteLtp, isLoading: kiteLtpLoading } = useKiteLtp(["NSE:RELIANCE", "NSE:TCS", "NSE:INFY"]);
  const { data: account, error, isLoading: accountLoading, isFetching, refetch } = useKiteAccount();
  const queryClient = useQueryClient();
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const livePrices = Object.values(kiteLtp ?? {});

  async function refreshAccount() {
    setRefreshing(true);
    setRefreshMessage(null);
    try {
      await apiPost("/api/kite/account/refresh");
      setRefreshMessage("Account refreshed from broker.");
      await queryClient.invalidateQueries({ queryKey: ["kite-account"] });
      await refetch();
    } catch (err) {
      setRefreshMessage(err instanceof Error ? err.message : "Refresh failed.");
    } finally {
      setRefreshing(false);
    }
  }

  const cash = account?.funds?.equity?.available?.cash;
  const used = account?.funds?.equity?.utilised?.debits;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Broker & Account"
        description="Zerodha Kite login and read-only account state. Observation is not live execution."
        meta={<StatusPill label="Phase 2" tone="success" />}
      />

      <KiteConnectionPanel livePrices={livePrices} livePricesLoading={kiteLtpLoading} />

      <Panel
        title="Broker AccountState"
        action={
          <Button size="sm" variant="outline" className="gap-2" disabled={refreshing} onClick={refreshAccount}>
            <RefreshCw className={refreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            Refresh from Kite
          </Button>
        }
      >
        {kiteStatusLoading || accountLoading ? (
          <div className="space-y-4">
            <StatGridSkeleton />
            <div className="grid gap-4 xl:grid-cols-2">
              <TableSkeleton columns={4} rows={3} />
              <TableSkeleton columns={4} rows={3} />
            </div>
          </div>
        ) : kiteStatus?.status !== "CONNECTED" && !account ? (
          <p className="text-sm text-muted">Connect Kite, then refresh to load profile, funds, positions, and orders.</p>
        ) : error && !account ? (
          <p className="text-sm text-warning">
            {(error as Error).message}. Call refresh after login to create the first snapshot.
          </p>
        ) : account ? (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <StatusPill label={account.source} tone="info" />
              <StatusPill label={account.refreshStatus} tone={account.refreshStatus === "COMPLETE" ? "success" : "warning"} />
              <StatusPill label={account.authenticated ? "Authenticated" : "Not authenticated"} tone={account.authenticated ? "success" : "danger"} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <MiniStat label="Available cash" value={cash == null ? "—" : formatInr(cash)} />
              <MiniStat label="Used margin" value={used == null ? "—" : formatInr(used)} />
              <MiniStat label="Day P&L" value={formatInr(account.pnl.day)} />
              <MiniStat label="Open positions" value={String(account.positions.length)} />
            </div>
            {refreshMessage && <p className="text-xs text-muted">{refreshMessage}</p>}
            {account.errors.length > 0 && (
              <p className="text-xs text-warning">
                Partial errors: {account.errors.map((e) => `${e.section}: ${e.message}`).join(" · ")}
              </p>
            )}
            <div className="grid gap-4 xl:grid-cols-2">
              <PositionsTable positions={account.positions} />
              <OrdersTable orders={account.orders} />
            </div>
            {isFetching && <p className="text-xs text-muted">Updating…</p>}
          </div>
        ) : null}
      </Panel>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-background/60 p-3">
      <div className="text-xs uppercase text-muted">{label}</div>
      <div className="mt-1 font-mono text-lg font-semibold">{value}</div>
    </div>
  );
}

function PositionsTable({
  positions
}: {
  positions: Array<{ tradingSymbol: string; quantity: number; pnl: number | null; book: string; product: string }>;
}) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase text-muted">Positions</h3>
      <div className="overflow-x-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Symbol</TableHead>
              <TableHead>Book</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">P&L</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {positions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-muted">
                  No open broker positions
                </TableCell>
              </TableRow>
            ) : (
              positions.slice(0, 12).map((p) => (
                <TableRow key={`${p.book}-${p.tradingSymbol}-${p.product}`}>
                  <TableCell className="font-mono font-semibold">{p.tradingSymbol}</TableCell>
                  <TableCell>{p.book}</TableCell>
                  <TableCell className="text-right font-mono">{p.quantity}</TableCell>
                  <TableCell className="text-right font-mono">{p.pnl == null ? "—" : formatInr(p.pnl)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function OrdersTable({
  orders
}: {
  orders: Array<{ orderId: string; tradingSymbol: string; status: string; transactionType: string; quantity: number }>;
}) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase text-muted">Orders</h3>
      <div className="overflow-x-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Symbol</TableHead>
              <TableHead>Side</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Qty</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-muted">
                  No broker orders in snapshot
                </TableCell>
              </TableRow>
            ) : (
              orders.slice(0, 12).map((o) => (
                <TableRow key={o.orderId}>
                  <TableCell className="font-mono font-semibold">{o.tradingSymbol}</TableCell>
                  <TableCell>{o.transactionType}</TableCell>
                  <TableCell>{o.status}</TableCell>
                  <TableCell className="text-right font-mono">{o.quantity}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
