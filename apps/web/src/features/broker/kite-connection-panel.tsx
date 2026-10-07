import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, KeyRound, LockKeyhole, RadioTower, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatInr } from "@/components/ui/status";
import { cn } from "@/lib/utils";
import { apiPost } from "@/api/client";
import { useKiteMargins, useKiteProfile, useKiteStatus } from "@/api/queries";
import { ConnectionPanelSkeleton, Skeleton } from "@/components/ui/skeleton";

export function KiteConnectionPanel({
  livePrices,
  livePricesLoading,
  fallbackLoginUrl = "http://localhost:4000/api/broker/kite/login-url"
}: {
  livePrices: Array<{ symbol: string; lastPrice: number; updatedAt: string }>;
  livePricesLoading?: boolean;
  fallbackLoginUrl?: string;
}) {
  const queryClient = useQueryClient();
  const { data: kiteStatus, isLoading: kiteStatusLoading } = useKiteStatus();
  const [requestToken, setRequestToken] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isConnected = kiteStatus?.status === "CONNECTED";
  const loginUrl = kiteStatus?.loginUrl ?? fallbackLoginUrl;
  const { data: kiteProfile, isLoading: kiteProfileLoading } = useKiteProfile(isConnected);
  const { data: kiteMargins, isLoading: kiteMarginsLoading } = useKiteMargins(isConnected);
  const profile = isConnected ? kiteProfile : undefined;
  const margins = isConnected ? kiteMargins : undefined;
  const verifiedUser = isConnected ? kiteStatus?.user : undefined;

  async function submitKiteToken(path: string, body: unknown) {
    setIsSubmitting(true);
    setConnectionMessage(null);

    try {
      const response = await apiPost<{ message: string }>(path, body);
      setConnectionMessage(response.message);
      setRequestToken("");
      setAccessToken("");
    } catch (error) {
      setConnectionMessage(error instanceof Error ? error.message : "Unable to connect Kite.");
    } finally {
      await queryClient.invalidateQueries({ queryKey: ["kite-status"] });
      await queryClient.invalidateQueries({ queryKey: ["kite-ltp"] });
      await queryClient.invalidateQueries({ queryKey: ["kite-account"] });
      setIsSubmitting(false);
    }
  }

  if (kiteStatusLoading) {
    return <ConnectionPanelSkeleton />;
  }

  return (
    <Card>
      <CardContent className="grid gap-4 pt-4 xl:grid-cols-[1.05fr,1fr,1.1fr]">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <RadioTower className="h-4 w-4 text-accent" />
            Kite Login
          </div>
          <p className="mt-2 text-sm text-muted">
            Kite powers account observation and market data. Live order placement stays disabled.
          </p>
          <p className="mt-2 text-xs text-muted">{kiteStatus?.reason ?? "Checking Kite connection..."}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Button
              size="sm"
              className="gap-2"
              disabled={isConnected}
              onClick={() => window.open(loginUrl, "_blank", "noopener,noreferrer")}
            >
              <ExternalLink className="h-4 w-4" />
              {isConnected ? "Kite Connected" : kiteStatus?.status === "VERIFYING" ? "Verifying Kite" : "Login with Kite"}
            </Button>
            <Button variant="outline" size="sm" disabled>
              <LockKeyhole className="mr-2 h-4 w-4" />
              Live Orders Locked
            </Button>
          </div>
          <div className="mt-4 grid gap-2 rounded-md border border-border bg-background/70 p-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted">Broker</span>
              <span className={cn("font-semibold", isConnected ? "text-success" : "text-warning")}>
                {isConnected ? "Connected" : kiteStatus?.status === "AUTH_REQUIRED" ? "Login required" : kiteStatus?.status === "VERIFYING" ? "Verifying" : "Not connected"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted">Market data</span>
              <span className={cn("font-semibold", kiteStatus?.marketDataLive ? "text-success" : "text-info")}>
                {kiteStatus?.marketDataLive ? "WebSocket live" : "REST after login"}
              </span>
            </div>
          </div>
        </div>

        {isConnected ? (
          <div className="space-y-3 rounded-md border border-success/30 bg-success/10 p-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase text-success">
              <KeyRound className="h-4 w-4" />
              Kite token stored
            </div>
            <p className="text-sm text-muted">Market data authentication is active.</p>
            <div className="grid gap-2 text-sm">
              <ProfileRow label="Session" value="Verified" />
              <ProfileRow label="Last verified" value={kiteStatus?.lastVerifiedAt ?? "-"} />
              <ProfileRow label="Live trading" value="Disabled" />
            </div>
          </div>
        ) : (
          <div className="space-y-3 rounded-md border border-border bg-background/70 p-3">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase text-muted">
                <KeyRound className="h-4 w-4 text-accent" />
                Store Kite token
              </div>
              <p className="mt-1 text-xs text-muted">A stored token is not treated as connected until Kite verifies it.</p>
            </div>
            <label className="block text-xs text-muted" htmlFor="kite-request-token">
              Request token
            </label>
            <input
              id="kite-request-token"
              className="h-9 w-full rounded-md border border-border bg-card px-3 font-mono text-sm text-foreground outline-none focus:border-accent"
              value={requestToken}
              onChange={(event) => setRequestToken(event.target.value)}
              placeholder="Paste request_token"
            />
            <Button
              size="sm"
              className="w-full"
              disabled={!requestToken || isSubmitting}
              onClick={() => submitKiteToken("/api/broker/kite/request-token", { requestToken })}
            >
              Store Access Token
            </Button>
            <div className="border-t border-border pt-3">
              <label className="block text-xs text-muted" htmlFor="kite-access-token">
                Access token from Kite
              </label>
              <input
                id="kite-access-token"
                className="mt-2 h-9 w-full rounded-md border border-border bg-card px-3 font-mono text-sm text-foreground outline-none focus:border-accent"
                value={accessToken}
                onChange={(event) => setAccessToken(event.target.value)}
                placeholder="Paste access_token"
                type="password"
              />
              <Button
                size="sm"
                variant="outline"
                className="mt-3 w-full"
                disabled={!accessToken || isSubmitting}
                onClick={() => submitKiteToken("/api/broker/kite/access-token", { accessToken })}
              >
                Verify Token
              </Button>
            </div>
            {connectionMessage && <p className="text-xs text-muted">{connectionMessage}</p>}
          </div>
        )}

        <div className="space-y-3">
          <div className="rounded-md border border-border bg-background/70 p-3">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase text-muted">
              <UserRound className="h-4 w-4 text-accent" />
              Kite profile
            </div>
            <div className="grid gap-2 text-sm">
              {isConnected && kiteProfileLoading ? (
                <ProfileSkeletonRows count={3} />
              ) : (
                <>
                  <ProfileRow label="Name" value={profile?.userName ?? verifiedUser?.userName ?? "-"} />
                  <ProfileRow label="Email" value={profile?.email ?? verifiedUser?.email ?? "-"} />
                  <ProfileRow label="User ID" value={profile?.userId ?? verifiedUser?.userId ?? "-"} />
                </>
              )}
              {isConnected && kiteMarginsLoading ? (
                <ProfileSkeletonRows count={2} />
              ) : (
                <>
                  <ProfileRow label="Available cash" value={margins ? formatInr(margins.availableCash) : "-"} />
                  <ProfileRow label="Used margin" value={margins ? formatInr(margins.usedMargin) : "-"} />
                </>
              )}
            </div>
          </div>

          <div className="overflow-x-auto rounded-md border border-border bg-background/70">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead className="text-right">LTP</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(livePricesLoading
                  ? Array.from({ length: 3 }, (_, index) => ({ symbol: `loading-${index}`, lastPrice: 0, updatedAt: "" }))
                  : livePrices.length
                  ? livePrices
                  : [{ symbol: "NSE:RELIANCE", lastPrice: 0, updatedAt: "Login required" }]
                ).map((price) => (
                  <TableRow key={price.symbol}>
                    {livePricesLoading ? (
                      <>
                        <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                        <TableCell><Skeleton className="ml-auto h-4 w-16" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      </>
                    ) : (
                      <>
                        <TableCell className="font-mono text-sm font-semibold">{price.symbol}</TableCell>
                        <TableCell className="text-right font-mono">{price.lastPrice ? formatInr(price.lastPrice) : "-"}</TableCell>
                        <TableCell className="text-muted">{price.updatedAt}</TableCell>
                      </>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border pb-2 last:border-b-0 last:pb-0">
      <span className="text-muted">{label}</span>
      <span className="max-w-[220px] truncate text-right font-semibold text-foreground">{value}</span>
    </div>
  );
}

function ProfileSkeletonRows({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex items-center justify-between border-b border-border pb-2 last:border-b-0 last:pb-0">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-24" />
        </div>
      ))}
    </>
  );
}
