/**
 * Read-only broker account state (Phase 2).
 *
 * Paper account state stays in AccountStateService.
 * This service never creates PaperAccount, Paper Position, Paper Order, or Trade rows.
 * It never calls Kite placeOrder / modifyOrder / cancelOrder.
 */
import { env, isDatabasePersistenceEnabled } from "../../../config/env";
import { getTradingDate, money } from "../../../common/utils/trading-date";
import { DEMO_USER_EMAIL, DEMO_USER_NAME } from "../../../db/domain";
import type { AppRepositories } from "../../../db/repositories/contracts";
import { getRepositories } from "../../../db/persistence";
import { AccountStateService } from "../../account-state/service";
import { KiteAccountError } from "./errors";
import { kiteAccountProvider } from "./kite-account-provider";
import { mockBrokerAccountProvider } from "./mock-account-provider";
import { sumPnl } from "./mappers";
import { assertRefreshInterval } from "./throttle";
import type {
  BrokerAccountProvider,
  BrokerAccountState,
  BrokerSectionError
} from "./types";

const SOURCE = "kite-account";

export class BrokerAccountService {
  constructor(
    private readonly resolveRepos: () => AppRepositories = getRepositories,
    private readonly provider: BrokerAccountProvider = defaultBrokerAccountProvider(),
    private readonly paperAccountState = new AccountStateService(resolveRepos)
  ) {}

  private repos() {
    return this.resolveRepos();
  }

  getPaperAccountState(userId?: string) {
    return this.paperAccountState.getCurrentAccountState(userId);
  }

  getBrokerAccountHealth() {
    return {
      configured: this.provider.isConfigured(),
      authenticated: this.provider.isAuthenticated(),
      accountReadable: this.provider.source === "MOCK" || this.provider.isAuthenticated(),
      source: this.provider.source
    };
  }

  async getBrokerAccountState(userId?: string): Promise<BrokerAccountState> {
    const user = await this.ensureUser(userId);
    const latest = await this.repos().brokerAccountSnapshots.findLatest(user.id, this.snapshotSource());

    if (latest) {
      return latest.state as BrokerAccountState;
    }

    if (this.provider.source === "MOCK") {
      return this.refreshBrokerAccount(user.id);
    }

    throw new KiteAccountError("KITE_ACCOUNT_NOT_REFRESHED", "No Kite account snapshot exists. Call POST /api/kite/account/refresh first.");
  }

  async listBrokerAccountSnapshots(userId?: string, limit = 50) {
    const user = await this.ensureUser(userId);
    return this.repos().brokerAccountSnapshots.listByUser(user.id, { source: this.snapshotSource(), limit });
  }

  async getProfile() {
    return (await this.requireState()).profile;
  }

  async getPositions() {
    return (await this.requireState()).positions;
  }

  async getOrders() {
    return (await this.requireState()).orders;
  }

  async getHoldings() {
    return (await this.requireState()).holdings;
  }

  async refreshBrokerAccount(userId?: string): Promise<BrokerAccountState> {
    const user = await this.ensureUser(userId);

    if (!assertRefreshInterval(user.id, env.KITE_ACCOUNT_REFRESH_MIN_INTERVAL_MS)) {
      throw new KiteAccountError("KITE_RATE_LIMITED", "Kite account refresh is throttled. Wait before retrying.");
    }

    await this.log(user.id, "INFO", "KITE_ACCOUNT_REFRESH_STARTED", "Read-only Kite account refresh started.");

    if (this.provider.source !== "MOCK" && !this.provider.isAuthenticated()) {
      await this.log(user.id, "WARN", "KITE_AUTH_EXPIRED", "Kite account refresh aborted; not authenticated.");
      throw new KiteAccountError("KITE_NOT_AUTHENTICATED", "Kite access token is missing. Complete Kite login first.");
    }

    const capturedAt = new Date().toISOString();
    const errors: BrokerSectionError[] = [];
    const profile = await this.loadSection("profile", () => this.provider.getProfile(), errors);
    const funds = await this.loadSection("funds", () => this.provider.getFunds(), errors);
    const positions = (await this.loadSection("positions", () => this.provider.getPositions(), errors)) ?? [];
    const orders = (await this.loadSection("orders", () => this.provider.getOrders(), errors)) ?? [];
    const holdings = (await this.loadSection("holdings", () => this.provider.getHoldings(), errors)) ?? [];

    if (!profile && !funds && positions.length === 0 && orders.length === 0 && holdings.length === 0) {
      await this.log(user.id, "ERROR", "KITE_ACCOUNT_REFRESH_FAILED", "Kite account refresh failed for every section.", {
        sections: errors.map((item) => item.section)
      });
      throw new KiteAccountError("KITE_ACCOUNT_REFRESH_FAILED", "Kite account refresh failed.");
    }

    const pnl = sumPnl(positions);
    const refreshStatus = errors.length === 0 ? "COMPLETE" : "PARTIAL";
    const state: BrokerAccountState = {
      source: this.provider.source,
      tradingMode: "LIVE",
      authenticated: this.provider.isAuthenticated(),
      refreshStatus,
      capturedAt,
      profile,
      funds,
      positions,
      orders,
      holdings,
      pnl,
      errors
    };

    await this.persistSnapshots(user.id, state);
    await this.log(
      user.id,
      errors.length ? "WARN" : "INFO",
      errors.length ? "KITE_ACCOUNT_REFRESH_FAILED" : "KITE_ACCOUNT_REFRESH_SUCCEEDED",
      errors.length ? "Kite account refresh completed with section errors." : "Kite account refresh succeeded.",
      { refreshStatus, sectionsFailed: errors.map((item) => item.section) }
    );

    if (errors.some((item) => item.code === "KITE_RATE_LIMITED")) {
      await this.log(user.id, "WARN", "KITE_RATE_LIMITED", "Kite reported a rate limit during account refresh.");
    }

    return state;
  }

  private async requireState() {
    return this.getBrokerAccountState();
  }

  private snapshotSource() {
    return this.provider.source === "MOCK" ? "MOCK" : "KITE";
  }

  private async loadSection<T>(
    section: BrokerSectionError["section"],
    loader: () => Promise<T>,
    errors: BrokerSectionError[]
  ): Promise<T | null> {
    try {
      return await loader();
    } catch (error) {
      if (error instanceof KiteAccountError && (error.code === "KITE_NOT_AUTHENTICATED" || error.code === "KITE_AUTH_EXPIRED")) {
        throw error;
      }

      const code = error instanceof KiteAccountError ? error.code : "KITE_API_ERROR";
      const message = error instanceof Error ? error.message : "Unknown broker error";
      errors.push({ section, code, message });

      if (code === "KITE_RATE_LIMITED" || code === "KITE_AUTH_EXPIRED") {
        await this.logFromError(section, code, message);
      }

      return null;
    }
  }

  private async persistSnapshots(userId: string, state: BrokerAccountState) {
    const equity = state.funds?.equity;
    const availableCash = money(equity?.available.cash ?? 0);
    const usedMargin = money(equity?.utilised.debits ?? 0);
    const equityNet = money(equity?.net ?? 0);

    await this.repos().brokerAccountSnapshots.create({
      userId,
      source: this.snapshotSource(),
      tradingMode: "LIVE",
      event: "KITE_ACCOUNT_REFRESHED",
      refreshStatus: state.refreshStatus,
      equityNet,
      availableCash,
      usedMargin,
      realizedPnl: state.pnl.realised,
      unrealizedPnl: state.pnl.unrealised,
      dayPnl: state.pnl.day,
      positionCount: state.positions.filter((position) => position.book === "NET").length,
      orderCount: state.orders.length,
      holdingCount: state.holdings.length,
      state: structuredClone(state),
      capturedAt: new Date(state.capturedAt)
    });

    await this.repos().accountSnapshots.create({
      userId,
      brokerConnectionId: null,
      tradingMode: "LIVE",
      source: this.snapshotSource(),
      sessionDate: getTradingDate(),
      event: "KITE_ACCOUNT_REFRESHED",
      status: state.refreshStatus,
      startingCapital: null,
      equity: equityNet,
      buyingPower: money(equity?.available.liveBalance ?? availableCash),
      availableCash,
      usedMargin,
      realizedPnl: state.pnl.realised,
      unrealizedPnl: state.pnl.unrealised,
      dayPnl: state.pnl.day,
      openExposure: money(equity?.utilised.exposure ?? 0),
      riskUsedToday: null,
      tradesToday: null,
      openPositionCount: state.positions.filter((position) => position.book === "NET" && position.quantity !== 0).length,
      capturedAt: new Date(state.capturedAt)
    });
  }

  private async ensureUser(userId?: string) {
    if (userId) {
      const user = await this.repos().users.findById(userId);
      if (!user) {
        throw new Error("User not found for broker account state.");
      }
      return user;
    }

    return this.repos().users.upsertByEmail({ email: DEMO_USER_EMAIL, name: DEMO_USER_NAME });
  }

  private async logFromError(section: string, code: string, message: string) {
    const user = await this.ensureUser();
    await this.log(user.id, "WARN", code, `Kite ${section} section failed.`, { section });
    void message;
  }

  private async log(userId: string, level: "INFO" | "WARN" | "ERROR", event: string, message: string, metadata: Record<string, unknown> = {}) {
    await this.repos().systemLogs.create({
      userId,
      level,
      source: SOURCE,
      message,
      metadata: { event, ...metadata }
    });
  }
}

export function defaultBrokerAccountProvider(): BrokerAccountProvider {
  return isDatabasePersistenceEnabled() ? kiteAccountProvider : mockBrokerAccountProvider;
}

export const brokerAccountService = new BrokerAccountService();
