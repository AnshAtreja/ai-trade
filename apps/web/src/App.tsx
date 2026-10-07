import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/layout/app-shell";
import { OverviewPage } from "@/pages/overview-page";
import { BrokerPage } from "@/pages/broker-page";
import { MarketPage } from "@/pages/market-page";
import { ScannerPage } from "@/pages/scanner-page";
import { StrategiesPage } from "@/pages/strategies-page";
import { PaperPage } from "@/pages/paper-page";
import { BacktestingPage } from "@/pages/backtesting-page";
import { IntelligencePage } from "@/pages/intelligence-page";
import { AgentPage } from "@/pages/agent-page";
import { AlertsPage } from "@/pages/alerts-page";
import { ShadowLivePage } from "@/pages/shadow-live-page";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<OverviewPage />} />
          <Route path="broker" element={<BrokerPage />} />
          <Route path="market" element={<MarketPage />} />
          <Route path="scanner" element={<ScannerPage />} />
          <Route path="strategies" element={<StrategiesPage />} />
          <Route path="paper" element={<PaperPage />} />
          <Route path="backtesting" element={<BacktestingPage />} />
          <Route path="intelligence" element={<IntelligencePage />} />
          <Route path="agent" element={<AgentPage />} />
          <Route path="alerts" element={<AlertsPage />} />
          <Route path="shadow-live" element={<ShadowLivePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
