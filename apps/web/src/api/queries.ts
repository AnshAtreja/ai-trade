import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/api/client";
import type {
  BrokerAccountStatePayload,
  BrokerLtpQuotePayload,
  KiteMarginsPayload,
  KiteProfilePayload,
  KiteStatusPayload,
  MarketUniversePayload,
  MarketStreamStatusPayload,
  ModuleCardPayload,
  PaperAccountView,
  PaperExecutionStatusPayload,
  PaperOrderPayload,
  PaperTradePayload,
  ScannerLatestPayload,
  ScannerPipelinePayload,
  ScannerStatusPayload,
  StrategyEvaluatePayload,
  StrategyListPayload,
  StrategySignalsPayload,
  StrategyStatusPayload
} from "@/api/types";

export function useDashboardData() {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: () => apiFetch<ModuleCardPayload[]>("/api/dashboard")
  });
}

export function useKiteStatus() {
  return useQuery({
    queryKey: ["kite-status"],
    queryFn: () => apiFetch<KiteStatusPayload>("/api/broker/kite/status"),
    refetchInterval: 10_000,
    retry: false
  });
}

export function useKiteLtp(symbols: string[]) {
  const statusQuery = useKiteStatus();

  return useQuery({
    queryKey: ["kite-ltp", symbols],
    queryFn: () =>
      apiFetch<Record<string, BrokerLtpQuotePayload>>(
        `/api/broker/kite/ltp?symbols=${encodeURIComponent(symbols.join(","))}`
      ),
    enabled: symbols.length > 0 && statusQuery.data?.status === "CONNECTED" && statusQuery.isSuccess,
    refetchInterval: 5_000,
    retry: false
  });
}

export function useKiteProfile(enabled: boolean) {
  return useQuery({
    queryKey: ["kite-profile"],
    queryFn: () => apiFetch<KiteProfilePayload>("/api/broker/kite/profile"),
    enabled,
    retry: false
  });
}

export function useKiteMargins(enabled: boolean) {
  return useQuery({
    queryKey: ["kite-margins"],
    queryFn: () => apiFetch<KiteMarginsPayload>("/api/broker/kite/margins"),
    enabled,
    refetchInterval: 15_000,
    retry: false
  });
}

export function useScannerSignalPipeline() {
  return useQuery({
    queryKey: ["scanner-signal-pipeline"],
    queryFn: () => apiFetch<ScannerPipelinePayload>("/api/scanner/intraday/mock/signal-pipeline"),
    refetchInterval: 10_000,
    retry: false
  });
}

export function useProductionScannerStatus() {
  return useQuery({
    queryKey: ["scanner-status"],
    queryFn: () => apiFetch<ScannerStatusPayload>("/api/scanner/status"),
    refetchInterval: 5_000,
    retry: false
  });
}

export function useProductionScannerLatest() {
  return useQuery({
    queryKey: ["scanner-signals-latest"],
    queryFn: () => apiFetch<ScannerLatestPayload>("/api/scanner/signals/latest"),
    refetchInterval: 5_000,
    retry: false
  });
}

export function usePaperAccount() {
  return useQuery({
    queryKey: ["paper-account"],
    queryFn: () => apiFetch<PaperAccountView>("/api/paper-trading/account"),
    refetchInterval: 10_000,
    retry: false
  });
}

export function usePaperTrades() {
  return useQuery({
    queryKey: ["paper-trades"],
    queryFn: () => apiFetch<PaperTradePayload[]>("/api/paper-trading/trades"),
    refetchInterval: 10_000,
    retry: false
  });
}

export function usePaperOrders() {
  return useQuery({
    queryKey: ["paper-orders"],
    queryFn: () => apiFetch<PaperOrderPayload[]>("/api/paper-trading/orders"),
    refetchInterval: 10_000,
    retry: false
  });
}

export function usePaperExecutionStatus() {
  return useQuery({
    queryKey: ["paper-execution-status"],
    queryFn: () => apiFetch<PaperExecutionStatusPayload>("/api/paper-trading/execution/status"),
    refetchInterval: 5_000,
    retry: false
  });
}

export function useStrategies() {
  return useQuery({
    queryKey: ["strategies"],
    queryFn: () => apiFetch<StrategyListPayload>("/api/strategies"),
    refetchInterval: 15_000,
    retry: false
  });
}

export function useStrategyStatus() {
  return useQuery({
    queryKey: ["strategies-status"],
    queryFn: () => apiFetch<StrategyStatusPayload>("/api/strategies/status"),
    refetchInterval: 5_000,
    retry: false
  });
}

export function useStrategySignalsLatest() {
  return useQuery({
    queryKey: ["strategies-signals-latest"],
    queryFn: () =>
      apiFetch<{ setups: StrategyEvaluatePayload["evaluations"] }>("/api/strategies/signals/latest"),
    refetchInterval: 5_000,
    retry: false
  });
}

export function useStrategySignalsPersisted() {
  return useQuery({
    queryKey: ["strategies-signals"],
    queryFn: () => apiFetch<StrategySignalsPayload>("/api/strategies/signals?limit=50"),
    refetchInterval: 10_000,
    retry: false
  });
}

export function useKiteAccount() {
  return useQuery({
    queryKey: ["kite-account"],
    queryFn: () => apiFetch<BrokerAccountStatePayload>("/api/kite/account"),
    retry: false
  });
}

export function useMarketStreamStatus() {
  return useQuery({
    queryKey: ["market-stream-status"],
    queryFn: () => apiFetch<MarketStreamStatusPayload>("/api/market/stream/status"),
    refetchInterval: 5_000,
    retry: false
  });
}

export function useMarketUniverse(search: string, page: number, pageSize = 30) {
  return useQuery({
    queryKey: ["market-universe", search, page, pageSize],
    queryFn: async () => {
      const params = new URLSearchParams({ exchange: "NSE", page: String(page), pageSize: String(pageSize) });
      if (search.trim()) params.set("search", search.trim());
      return apiFetch<MarketUniversePayload>(`/api/market/universe/equities?${params.toString()}`);
    },
    retry: false
  });
}
