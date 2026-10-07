/**
 * Derived paper account + risk state (Phase 1C).
 *
 * AccountSnapshot is an immutable audit observation, not the live ledger.
 * Current state is reconstructed from PaperAccount.startingCapital + trades + positions + RiskConfiguration.
 */
import { env } from "../../config/env";
import { DEMO_USER_EMAIL, DEMO_USER_NAME } from "../../db/domain";
import type { AppRepositories } from "../../db/repositories/contracts";
import { getRepositories } from "../../db/persistence";
import type { RiskConfigurationRecord } from "../../db/domain";
import { money } from "../../common/utils/trading-date";
import type { RiskProfile } from "../risk/types";
import {
  accountStatus,
  availableCapital,
  currentEquity,
  dailyLossLimit,
  maxRiskPerTrade,
  openExposure,
  realisedPnl,
  realisedPnlOnTradingDate,
  riskUsedToday,
  sessionDateFor,
  tradesOpenedOnTradingDate,
  unrealisedPnl,
  winningLosingToday,
  realisedLossesOnTradingDate
} from "./formulas";
import type { AccountSnapshotEvent, InitializePaperAccountInput, PaperAccountState, PaperAccountView } from "./types";

const SOURCE = "account-state";

export class AccountStateService {
  constructor(private readonly resolveRepos: () => AppRepositories = getRepositories) {}

  private repos() {
    return this.resolveRepos();
  }

  async initializePaperAccount(userId?: string, input: InitializePaperAccountInput = {}) {
    const user = userId ? await this.repos().users.findById(userId) : await this.ensureUser();

    if (!user) {
      throw new Error("Cannot initialize paper account without a user.");
    }

    const created = await this.repos().runInTransaction(async (repos) => {
      let account = await repos.paperAccounts.findByUser(user.id, "PAPER");
      let initialized = false;

      if (!account) {
        try {
          account = await repos.paperAccounts.create({
            userId: user.id,
            tradingMode: "PAPER",
            startingCapital: money(input.startingCapital ?? env.PAPER_STARTING_CAPITAL),
            initializedAt: new Date()
          });
          initialized = true;
        } catch {
          account = await repos.paperAccounts.findByUser(user.id, "PAPER");
        }
      }

      if (!account) {
        throw new Error("Paper account initialization failed.");
      }

      let risk = await repos.riskConfigurations.findByUser(user.id, "PAPER");

      if (!risk) {
        risk = await repos.riskConfigurations.upsertForUser(this.defaultRiskWrite(user.id, account.startingCapital, input));
      }

      return { account, risk, initialized };
    });

    const state = await this.getCurrentAccountState(user.id);

    if (created.initialized) {
      await this.persistSnapshot(user.id, "PAPER_ACCOUNT_INITIALIZED", state);
      await this.log(user.id, "INFO", "PAPER_ACCOUNT_INITIALIZED", "Paper account initialized.", {
        startingCapital: created.account.startingCapital
      });
      await this.repos().journalEntries.create({
        authorId: user.id,
        tradeId: null,
        type: "SYSTEM",
        title: "PAPER_ACCOUNT_INITIALIZED",
        body: `Paper account started with capital ${created.account.startingCapital}.`,
        mood: null,
        tags: ["PAPER_ACCOUNT_INITIALIZED"],
        symbol: null
      });
    }

    return state;
  }

  getPaperAccountState(userId?: string, at = new Date()) {
    return this.getCurrentAccountState(userId, at);
  }

  async getCurrentAccountState(userId?: string, at = new Date()): Promise<PaperAccountState> {
    const user = userId ? await this.repos().users.findById(userId) : await this.ensureUser();

    if (!user) {
      throw new Error("User not found for paper account state.");
    }

    await this.ensureInitialized(user.id);
    return this.deriveState(this.repos(), user.id, at);
  }

  async refreshAccountState(userId?: string, event: AccountSnapshotEvent = "PAPER_ACCOUNT_REFRESHED") {
    const state = await this.getCurrentAccountState(userId);
    await this.persistSnapshot(state.userId, event, state);

    if (event === "PAPER_ACCOUNT_REFRESHED") {
      await this.log(state.userId, "INFO", "PAPER_ACCOUNT_REFRESHED", "Paper account state refreshed.", {
        equity: state.currentEquity,
        sessionDate: state.sessionDate
      });
    }

    return state;
  }

  async getAccountView(userId?: string): Promise<PaperAccountView> {
    const state = await this.getCurrentAccountState(userId);
    return this.toView(state);
  }

  async listSnapshots(userId?: string, limit = 50) {
    const user = userId ? await this.repos().users.findById(userId) : await this.ensureUser();

    if (!user) {
      return [];
    }

    return this.repos().accountSnapshots.listByUser(user.id, { tradingMode: "PAPER", limit });
  }

  toView(state: PaperAccountState): PaperAccountView {
    return {
      tradingMode: "PAPER",
      startingCapital: state.startingCapital,
      currentEquity: state.currentEquity,
      availableCapital: state.availableCapital,
      usedCapital: state.usedCapital,
      realisedPnl: state.realisedPnl,
      unrealisedPnl: state.unrealisedPnl,
      totalPnl: state.totalPnl,
      dayPnl: state.dayPnl,
      openExposure: state.openExposure,
      tradesToday: state.tradesToday,
      openPositions: state.openPositions,
      riskUsedToday: state.riskUsedToday,
      riskRemainingToday: state.riskRemainingToday,
      status: state.status
    };
  }

  toRiskProfile(risk: RiskConfigurationRecord): RiskProfile {
    return {
      capital: risk.capital,
      maxRiskPerTradePercent: risk.maxRiskPerTradePercent,
      maxDailyLossPercent: risk.maxDailyLossPercent,
      maxTradesPerDay: risk.maxTradesPerDay,
      maxPositionSize: risk.maxPositionSize,
      maxOpenPositions: risk.maxOpenPositions,
      maxCapitalExposure: risk.maxCapitalExposure,
      allowShortSelling: risk.allowShortSelling,
      tradeStartTime: risk.tradeStartTime,
      tradeEndTime: risk.tradeEndTime
    };
  }

  async deriveState(repos: AppRepositories, userId: string, at = new Date()): Promise<PaperAccountState> {
    const account = await repos.paperAccounts.findByUser(userId, "PAPER");
    const risk = await repos.riskConfigurations.findByUser(userId, "PAPER");

    if (!account || !risk) {
      throw new Error("Paper account is not initialized.");
    }

    const [positions, trades] = await Promise.all([
      repos.positions.listByUser(userId, { tradingMode: "PAPER" }),
      repos.trades.listByUser(userId, { tradingMode: "PAPER" })
    ]);

    const sessionDate = sessionDateFor(at);
    const openPositions = positions.filter((position) => position.status === "OPEN");
    const realised = realisedPnl(trades);
    const unrealised = unrealisedPnl(openPositions);
    const equity = currentEquity(account.startingCapital, realised, unrealised);
    const exposure = openExposure(openPositions);
    const usedCapital = exposure;
    const dayRealised = realisedPnlOnTradingDate(trades, sessionDate);
    const dayPnl = money(dayRealised + unrealised);
    const lossLimit = dailyLossLimit(risk.capital, risk.maxDailyLossPercent);
    const usedRisk = riskUsedToday(trades, openPositions, sessionDate);
    const todayTrades = tradesOpenedOnTradingDate(trades, sessionDate);
    const { winningTradesToday, losingTradesToday } = winningLosingToday(trades, sessionDate);
    const status = accountStatus(dayPnl, lossLimit);

    return {
      tradingMode: "PAPER",
      userId,
      sessionDate,
      startingCapital: account.startingCapital,
      currentEquity: equity,
      availableCapital: availableCapital(equity, usedCapital),
      usedCapital,
      realisedPnl: realised,
      unrealisedPnl: unrealised,
      totalPnl: money(realised + unrealised),
      dayPnl,
      openExposure: exposure,
      tradesToday: todayTrades.length,
      openPositions: openPositions.length,
      winningTradesToday,
      losingTradesToday,
      dailyLossLimit: lossLimit,
      maxRiskPerTrade: maxRiskPerTrade(risk.capital, risk.maxRiskPerTradePercent),
      maxOpenPositions: risk.maxOpenPositions,
      maxTradesPerDay: risk.maxTradesPerDay,
      maxCapitalExposure: risk.maxCapitalExposure,
      riskUsedToday: usedRisk,
      riskRemainingToday: money(Math.max(0, lossLimit - usedRisk)),
      realisedLossesToday: realisedLossesOnTradingDate(trades, sessionDate),
      status,
      capturedAt: at.toISOString()
    };
  }

  async persistSnapshot(userId: string, event: AccountSnapshotEvent, state?: PaperAccountState, repos = this.repos()) {
    const snapshot = state ?? (await this.deriveState(repos, userId));

    await repos.accountSnapshots.create({
      userId,
      brokerConnectionId: null,
      tradingMode: "PAPER",
      source: "PAPER",
      sessionDate: snapshot.sessionDate,
      event,
      status: snapshot.status,
      startingCapital: snapshot.startingCapital,
      equity: snapshot.currentEquity,
      buyingPower: snapshot.availableCapital,
      availableCash: snapshot.availableCapital,
      usedMargin: snapshot.usedCapital,
      realizedPnl: snapshot.realisedPnl,
      unrealizedPnl: snapshot.unrealisedPnl,
      dayPnl: snapshot.dayPnl,
      openExposure: snapshot.openExposure,
      riskUsedToday: snapshot.riskUsedToday,
      tradesToday: snapshot.tradesToday,
      openPositionCount: snapshot.openPositions,
      capturedAt: new Date()
    });
  }

  private async ensureInitialized(userId: string) {
    const account = await this.repos().paperAccounts.findByUser(userId, "PAPER");

    if (!account) {
      await this.initializePaperAccount(userId);
    }
  }

  private defaultRiskWrite(userId: string, startingCapital: number, input: InitializePaperAccountInput) {
    const override = input.riskConfiguration ?? {};

    return {
      userId,
      tradingMode: "PAPER" as const,
      capital: override.capital ?? startingCapital,
      maxRiskPerTradePercent: override.maxRiskPerTradePercent ?? env.PAPER_MAX_RISK_PER_TRADE_PERCENT,
      maxDailyLossPercent: override.maxDailyLossPercent ?? env.PAPER_MAX_DAILY_LOSS_PERCENT,
      maxTradesPerDay: override.maxTradesPerDay ?? env.PAPER_MAX_TRADES_PER_DAY,
      maxPositionSize: override.maxPositionSize ?? env.PAPER_MAX_POSITION_SIZE,
      maxOpenPositions: override.maxOpenPositions ?? env.PAPER_MAX_OPEN_POSITIONS,
      maxCapitalExposure: override.maxCapitalExposure ?? env.PAPER_MAX_CAPITAL_EXPOSURE ?? startingCapital,
      allowShortSelling: override.allowShortSelling ?? env.PAPER_ALLOW_SHORT_SELLING,
      tradeStartTime: override.tradeStartTime ?? "09:30",
      tradeEndTime: override.tradeEndTime ?? "15:30"
    };
  }

  private async ensureUser() {
    return this.repos().users.upsertByEmail({ email: DEMO_USER_EMAIL, name: DEMO_USER_NAME });
  }

  private async log(userId: string, level: "INFO" | "WARN", event: string, message: string, metadata: Record<string, unknown>) {
    await this.repos().systemLogs.create({
      userId,
      level,
      source: SOURCE,
      message,
      metadata: { event, ...metadata }
    });
  }
}

export const accountStateService = new AccountStateService();
