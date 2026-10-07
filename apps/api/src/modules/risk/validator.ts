import type {
  AccountRiskContext,
  CurrentDayStats,
  RiskProfile,
  RiskRejectionReason,
  TradeRiskValidationResult,
  TradeSignal
} from "./types";

export function validateTrade(
  signal: TradeSignal,
  riskProfile: RiskProfile,
  currentDayStats: CurrentDayStats,
  accountContext?: AccountRiskContext
): TradeRiskValidationResult {
  const rejectionReasons: RiskRejectionReason[] = [];
  const riskBudget = money(riskProfile.capital * (riskProfile.maxRiskPerTradePercent / 100));
  const dailyLossLimit = money(riskProfile.capital * (riskProfile.maxDailyLossPercent / 100));
  const stopLoss = signal.stopLoss;
  const hasValidQuantity = Number.isInteger(signal.quantity) && signal.quantity > 0;
  const isShort = signal.side === "SHORT" || signal.side === "SELL";

  if (stopLoss === undefined) {
    rejectionReasons.push({
      code: "STOP_LOSS_MISSING",
      message: "Stop loss is required before a trade can be accepted."
    });
  }

  if (!hasValidQuantity) {
    rejectionReasons.push({
      code: "INVALID_QUANTITY",
      message: "Quantity must be a positive whole number."
    });
  }

  if (isShort && !riskProfile.allowShortSelling) {
    rejectionReasons.push({
      code: "SHORT_SELLING_NOT_ALLOWED",
      message: "Short selling is disabled for this risk profile."
    });
  }

  if (!isWithinTradeWindow(signal.timestamp, riskProfile.tradeStartTime, riskProfile.tradeEndTime)) {
    rejectionReasons.push({
      code: "OUTSIDE_ALLOWED_TIME",
      message: `Trade timestamp must be between ${riskProfile.tradeStartTime} and ${riskProfile.tradeEndTime}.`
    });
  }

  if (currentDayStats.dailyLoss >= dailyLossLimit) {
    rejectionReasons.push({
      code: "DAILY_LOSS_LIMIT_REACHED",
      message: `Daily loss limit reached. Current loss is ${formatMoney(currentDayStats.dailyLoss)} of ${formatMoney(dailyLossLimit)}.`
    });
  }

  if (currentDayStats.tradesTaken >= riskProfile.maxTradesPerDay) {
    rejectionReasons.push({
      code: "MAX_TRADES_REACHED",
      message: `Max trades reached for the day (${riskProfile.maxTradesPerDay}).`
    });
  }

  const riskPerShare = stopLoss === undefined ? 0 : calculateRiskPerShare(signal, stopLoss);
  const rewardPerShare = calculateRewardPerShare(signal);
  const calculatedQuantity = calculateAllowedQuantity(signal.entryPrice, riskPerShare, riskBudget, riskProfile.maxPositionSize);
  const maxLoss = money(riskPerShare * (hasValidQuantity ? signal.quantity : 0));

  if (stopLoss !== undefined && riskPerShare <= 0) {
    rejectionReasons.push({
      code: "INVALID_STOP_LOSS",
      message: isShort
        ? "Stop loss for a short trade must be above the entry price."
        : "Stop loss for a long trade must be below the entry price."
    });
  }

  if (rewardPerShare <= 0) {
    rejectionReasons.push({
      code: "INVALID_TARGET",
      message: isShort
        ? "Target for a short trade must be below the entry price."
        : "Target for a long trade must be above the entry price."
    });
  }

  if (riskPerShare > 0 && rewardPerShare > 0 && rewardPerShare < riskPerShare) {
    rejectionReasons.push({
      code: "TARGET_SMALLER_THAN_RISK",
      message: `Target reward per share (${formatMoney(rewardPerShare)}) is smaller than risk per share (${formatMoney(riskPerShare)}).`
    });
  }

  if (maxLoss > riskBudget) {
    rejectionReasons.push({
      code: "RISK_PER_TRADE_EXCEEDS_LIMIT",
      message: `Trade risk ${formatMoney(maxLoss)} exceeds per-trade limit ${formatMoney(riskBudget)}.`
    });
  }

  if (riskPerShare > 0 && currentDayStats.dailyLoss + maxLoss > dailyLossLimit) {
    rejectionReasons.push({
      code: "DAILY_LOSS_LIMIT_WOULD_BE_EXCEEDED",
      message: `Trade max loss would exceed the daily loss limit of ${formatMoney(dailyLossLimit)}.`
    });
  }

  if (hasValidQuantity && signal.quantity * signal.entryPrice > riskProfile.maxPositionSize) {
    rejectionReasons.push({
      code: "POSITION_SIZE_EXCEEDS_LIMIT",
      message: `Position value ${formatMoney(signal.quantity * signal.entryPrice)} exceeds max position size ${formatMoney(riskProfile.maxPositionSize)}.`
    });
  }

  applyAccountRiskChecks(rejectionReasons, riskProfile, accountContext);

  return {
    allowed: rejectionReasons.length === 0,
    rejectionReasons,
    calculatedQuantity,
    maxLoss
  };
}

function applyAccountRiskChecks(
  rejectionReasons: RiskRejectionReason[],
  riskProfile: RiskProfile,
  accountContext?: AccountRiskContext
) {
  if (!accountContext) {
    return;
  }

  const maxOpenPositions = accountContext.maxOpenPositions ?? riskProfile.maxOpenPositions;
  const maxCapitalExposure = accountContext.maxCapitalExposure ?? riskProfile.maxCapitalExposure;
  const dailyLossLimit = accountContext.dailyLossLimit;

  if (accountContext.status === "TRADING_BLOCKED_DAILY_LOSS" || accountContext.dayPnl <= -dailyLossLimit) {
    rejectionReasons.push({
      code: "TRADING_BLOCKED_DAILY_LOSS",
      message: `Daily loss protection is active. Day PnL ${formatMoney(accountContext.dayPnl)} reached the limit of ${formatMoney(dailyLossLimit)}.`
    });
  }

  if (maxOpenPositions != null && accountContext.openPositions >= maxOpenPositions) {
    rejectionReasons.push({
      code: "MAX_OPEN_POSITIONS_REACHED",
      message: `Open paper positions (${accountContext.openPositions}) already at the maximum of ${maxOpenPositions}.`
    });
  }

  if (accountContext.newTradeExposure > 0 && accountContext.newTradeExposure > accountContext.availableCapital) {
    rejectionReasons.push({
      code: "INSUFFICIENT_AVAILABLE_CAPITAL",
      message: `Trade exposure ${formatMoney(accountContext.newTradeExposure)} exceeds available capital ${formatMoney(accountContext.availableCapital)}.`
    });
  }

  if (
    maxCapitalExposure != null &&
    accountContext.newTradeExposure > 0 &&
    accountContext.openExposure + accountContext.newTradeExposure > maxCapitalExposure
  ) {
    rejectionReasons.push({
      code: "MAX_CAPITAL_EXPOSURE_EXCEEDED",
      message: `Open exposure ${formatMoney(accountContext.openExposure + accountContext.newTradeExposure)} would exceed the maximum of ${formatMoney(maxCapitalExposure)}.`
    });
  }
}

function calculateRiskPerShare(signal: TradeSignal, stopLoss: number) {
  return signal.side === "SHORT" || signal.side === "SELL"
    ? money(stopLoss - signal.entryPrice)
    : money(signal.entryPrice - stopLoss);
}

function calculateRewardPerShare(signal: TradeSignal) {
  return signal.side === "SHORT" || signal.side === "SELL"
    ? money(signal.entryPrice - signal.targetPrice)
    : money(signal.targetPrice - signal.entryPrice);
}

function calculateAllowedQuantity(entryPrice: number, riskPerShare: number, riskBudget: number, maxPositionSize: number) {
  if (riskPerShare <= 0 || entryPrice <= 0) {
    return 0;
  }

  const quantityByRisk = Math.floor(riskBudget / riskPerShare);
  const quantityByPositionSize = Math.floor(maxPositionSize / entryPrice);

  return Math.max(0, Math.min(quantityByRisk, quantityByPositionSize));
}

function isWithinTradeWindow(timestamp: string, startTime: string, endTime: string) {
  const tradeMinutes = parseTradeMinutes(timestamp);
  const startMinutes = parseClockMinutes(startTime);
  const endMinutes = parseClockMinutes(endTime);

  if (tradeMinutes === null || startMinutes === null || endMinutes === null) {
    return false;
  }

  if (startMinutes <= endMinutes) {
    return tradeMinutes >= startMinutes && tradeMinutes <= endMinutes;
  }

  return tradeMinutes >= startMinutes || tradeMinutes <= endMinutes;
}

function parseTradeMinutes(value: string) {
  const isoDate = new Date(value);

  if (!Number.isNaN(isoDate.getTime()) && value.includes("T")) {
    return isoDate.getHours() * 60 + isoDate.getMinutes();
  }

  return parseClockMinutes(value);
}

function parseClockMinutes(value: string) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);

  if (!match) {
    return null;
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

function money(value: number) {
  return Number(value.toFixed(2));
}

function formatMoney(value: number) {
  return `$${money(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
