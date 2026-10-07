import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel } from "@/components/ui/page";
import { StatusPill } from "@/components/ui/status";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiPost } from "@/api/client";
import { useMarketStreamStatus, useMarketUniverse } from "@/api/queries";
import { StatGridSkeleton, TableSkeleton } from "@/components/ui/skeleton";

export function MarketPage() {
  const { data: streamStatus, isLoading: streamStatusLoading, refetch: refetchStream } = useMarketStreamStatus();
  const [universeSearch, setUniverseSearch] = useState("");
  const [universePage, setUniversePage] = useState(1);
  const { data: universe, isLoading, error, refetch: refetchUniverse } = useMarketUniverse(universeSearch, universePage, 30);
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function syncInstruments() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await apiPost<{ received: number; inserted: number; updated: number }>("/api/market/instruments/sync");
      setMessage(`Instrument sync complete · received ${result.received}, inserted ${result.inserted}, updated ${result.updated}.`);
      await queryClient.invalidateQueries({ queryKey: ["market-universe"] });
      await refetchUniverse();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Sync failed.");
    } finally {
      setBusy(false);
    }
  }

  async function startStream() {
    setBusy(true);
    setMessage(null);
    try {
      await apiPost("/api/market/stream/start");
      setMessage("Market stream start requested.");
      await refetchStream();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Start failed.");
    } finally {
      setBusy(false);
    }
  }

  async function stopStream() {
    setBusy(true);
    setMessage(null);
    try {
      await apiPost("/api/market/stream/stop");
      setMessage("Market stream stopped.");
      await refetchStream();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Stop failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Market"
        description="Prepare the instrument universe, then start the market stream used by Scanner and Strategies."
        meta={<StatusPill label={streamStatus?.connected ? "Stream connected" : "REST only"} tone={streamStatus?.connected ? "success" : "info"} />}
      />

      <div className="border-l-2 border-info px-3 py-2 text-sm text-muted">
        <span className="font-semibold text-foreground">Flow:</span> connect Kite on Broker → sync the NSE universe → start the stream → check for CONNECTED before using Scanner or Strategies.
      </div>

      <Panel
        title="Stream health"
        action={
          <div className="flex gap-2">
            <Button size="sm" className="gap-2" disabled={busy} onClick={startStream}>
              <Play className="h-4 w-4" />
              Start stream
            </Button>
            <Button size="sm" variant="outline" className="gap-2" disabled={busy} onClick={stopStream}>
              <Square className="h-4 w-4" />
              Stop stream
            </Button>
          </div>
        }
      >
        {streamStatusLoading ? <StatGridSkeleton count={6} /> : streamStatus ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Mini label="State" value={streamStatus.state} />
            <Mini label="Source" value={streamStatus.source} />
            <Mini label="Subscriptions" value={String(streamStatus.subscriptionCount)} />
            <Mini label="Reconnects" value={String(streamStatus.reconnectCount)} />
            <Mini label="Last message" value={streamStatus.lastMessageAt ?? "—"} />
            <Mini label="Last error" value={streamStatus.lastError?.message ?? "None"} />
          </div>
        ) : <p className="text-sm text-muted">Stream status unavailable.</p>}
        {message && <p className="mt-3 text-xs text-muted">{message}</p>}
      </Panel>

      <Panel
        title="Intraday equity universe"
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <input
              aria-label="Search NSE equities"
              value={universeSearch}
              onChange={(event) => { setUniverseSearch(event.target.value); setUniversePage(1); }}
              placeholder="Search symbol or name"
              className="h-8 w-48 rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-accent"
            />
            <Button size="sm" variant="outline" disabled={busy} onClick={syncInstruments}>
              Sync universe
            </Button>
          </div>
        }
      >
        {isLoading ? (
          <TableSkeleton columns={4} rows={8} />
        ) : error ? (
          <p className="text-sm text-warning">
            {(error as Error).message}. Sync instruments after Kite login (or use mock mode fixtures).
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Exchange</TableHead>
                  <TableHead>Token</TableHead>
                  <TableHead>Type</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(universe?.equities ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-muted">
                      {universeSearch ? "No matching NSE equities." : "No equities yet — run Sync instruments."}
                    </TableCell>
                  </TableRow>
                ) : (
                  (universe?.equities ?? []).map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono font-semibold">{row.tradingSymbol}</TableCell>
                      <TableCell>{row.exchange}</TableCell>
                      <TableCell className="font-mono text-xs text-muted">{row.instrumentToken}</TableCell>
                      <TableCell>{row.instrumentType ?? "—"}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
        {!isLoading && !error && universe && (universe.equities.length > 0 || universePage > 1) && (
          <div className="mt-3 flex items-center justify-between text-xs text-muted">
            <span>Page {universe.page} · showing {universe.equities.length} equities</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={universePage === 1 || busy} onClick={() => setUniversePage((page) => page - 1)}>
                Previous
              </Button>
              <Button size="sm" variant="outline" disabled={!universe.hasNext || busy} onClick={() => setUniversePage((page) => page + 1)}>
                Next
              </Button>
            </div>
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
