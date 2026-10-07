import { aiAnalysisService } from "../ai-analysis/service";
import type { AiScannerAnalysisInput, AiScannerAnalysisOutput } from "../ai-analysis/types";
import { mockRiskProfile } from "../risk/mock-data";
import type { TradeRiskValidationResult, TradeSignal } from "../risk/types";
import { validateTrade } from "../risk/validator";
import { intradayScannerEngine } from "./engine";
import { mockIntradayInstruments } from "./mock-data";
import type { IntradayInstrumentInput, IntradayWatchlistCandidate } from "./types";

export interface ScannerSignalCardData {
  symbol: string;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  score: number;
  matchedSignals: string[];
  entryTrigger: number;
  stopLoss: number;
  target: number;
  riskAmount: number;
  aiExplanation: string;
  riskApproved: boolean;
  suggestedAction: AiScannerAnalysisOutput["suggestedAction"];
  confidenceLabel: AiScannerAnalysisOutput["confidenceLabel"];
}

export interface ScannerPipelineItem {
  instrument: IntradayInstrumentInput;
  scanner: IntradayWatchlistCandidate;
  tradeSignal: TradeSignal;
  risk: TradeRiskValidationResult;
  ai: AiScannerAnalysisOutput;
  signalCard: ScannerSignalCardData;
}

export interface ScannerPipelineResult {
  signalCards: ScannerSignalCardData[];
  debug: {
    rawInstrumentInput: IntradayInstrumentInput[];
    scannerOutput: IntradayWatchlistCandidate[];
    riskOutput: Array<{
      symbol: string;
      output: TradeRiskValidationResult;
    }>;
    finalSignalCards: ScannerSignalCardData[];
  };
}

const currentDayStats = {
  dailyLoss: 0,
  tradesTaken: 0
};

export async function runMockScannerSignalPipeline(): Promise<ScannerPipelineResult> {
  const rawInstrumentInput: IntradayInstrumentInput[] = mockIntradayInstruments;
  const scannerOutput = intradayScannerEngine.scan(rawInstrumentInput);
  const pipelineItems = await Promise.all(
    scannerOutput
      .map((scanner) => {
        const instrument = rawInstrumentInput.find((item) => item.symbol.toUpperCase() === scanner.symbol);

        if (!instrument) {
          return null;
        }

        return {
          instrument,
          scanner
        };
      })
      .filter((item): item is { instrument: IntradayInstrumentInput; scanner: IntradayWatchlistCandidate } => Boolean(item))
      .map(async ({ instrument, scanner }) => {
        const tradeSignal = buildTradeSignal(instrument, scanner);
        const seedRisk = validateTrade({ ...tradeSignal, quantity: 1 }, mockRiskProfile, currentDayStats);
        const risk = validateTrade(
          {
            ...tradeSignal,
            quantity: Math.max(seedRisk.calculatedQuantity, 1)
          },
          mockRiskProfile,
          currentDayStats
        );
        const aiInput = buildAiInput(instrument, scanner, tradeSignal, risk);
        const ai = await aiAnalysisService.analyzeScannerOutput(aiInput);
        const signalCard = toSignalCard(scanner, tradeSignal, risk, ai);

        return {
          instrument,
          scanner,
          tradeSignal,
          risk,
          ai,
          signalCard
        };
      })
  );
  const watchableItems = pipelineItems.filter(isWatchable);
  const signalCards = watchableItems.map((item) => item.signalCard);

  return {
    signalCards,
    debug: {
      rawInstrumentInput,
      scannerOutput,
      riskOutput: pipelineItems.map((item) => ({
        symbol: item.scanner.symbol,
        output: item.risk
      })),
      finalSignalCards: signalCards
    }
  };
}

function buildTradeSignal(instrument: IntradayInstrumentInput, scanner: IntradayWatchlistCandidate): TradeSignal {
  const entryPrice = money(instrument.currentPrice);
  const side = scanner.direction === "BEARISH" ? "SHORT" : "BUY";
  const stopLoss = getStopLoss(instrument, scanner.direction);
  const riskPerShare = Math.abs(entryPrice - stopLoss);
  const targetPrice =
    scanner.direction === "BEARISH"
      ? money(entryPrice - riskPerShare * 2)
      : money(entryPrice + riskPerShare * 2);

  return {
    symbol: instrument.symbol,
    side,
    entryPrice,
    stopLoss,
    targetPrice,
    quantity: 1,
    timestamp: "10:15"
  };
}

function buildAiInput(
  instrument: IntradayInstrumentInput,
  scanner: IntradayWatchlistCandidate,
  tradeSignal: TradeSignal,
  risk: TradeRiskValidationResult
): AiScannerAnalysisInput {
  const riskPerShare = Math.abs(tradeSignal.entryPrice - tradeSignal.stopLoss!);
  const rewardPerShare = Math.abs(tradeSignal.targetPrice - tradeSignal.entryPrice);

  return {
    symbol: scanner.symbol,
    direction: scanner.direction,
    score: scanner.score,
    signals: scanner.matchedSignals,
    priceData: {
      currentPrice: instrument.currentPrice,
      openPrice: instrument.openPrice,
      previousClose: instrument.previousClose,
      currentVolume: instrument.currentVolume,
      averageVolume: instrument.averageVolume,
      dayHigh: instrument.dayHigh,
      dayLow: instrument.dayLow,
      vwap: instrument.vwap
    },
    riskData: {
      invalidationLevel: tradeSignal.stopLoss!,
      maxLoss: risk.maxLoss,
      calculatedQuantity: risk.calculatedQuantity,
      rewardToRiskRatio: riskPerShare > 0 ? money(rewardPerShare / riskPerShare) : 0,
      rejectionReasons: risk.rejectionReasons.map((reason) => reason.message)
    }
  };
}

function toSignalCard(
  scanner: IntradayWatchlistCandidate,
  tradeSignal: TradeSignal,
  risk: TradeRiskValidationResult,
  ai: AiScannerAnalysisOutput
): ScannerSignalCardData {
  return {
    symbol: scanner.symbol,
    direction: scanner.direction,
    score: scanner.score,
    matchedSignals: scanner.matchedSignals,
    entryTrigger: tradeSignal.entryPrice,
    stopLoss: tradeSignal.stopLoss!,
    target: tradeSignal.targetPrice,
    riskAmount: risk.maxLoss,
    aiExplanation: ai.summary,
    riskApproved: risk.allowed,
    suggestedAction: ai.suggestedAction,
    confidenceLabel: ai.confidenceLabel
  };
}

function isWatchable(item: ScannerPipelineItem) {
  return item.scanner.matchedSignals.length > 0 && item.scanner.score > 0;
}

function getStopLoss(instrument: IntradayInstrumentInput, direction: IntradayWatchlistCandidate["direction"]) {
  if (direction === "BEARISH") {
    const stop = instrument.vwap ?? instrument.dayHigh ?? instrument.previousHigh ?? instrument.currentPrice * 1.01;

    return money(Math.max(stop, instrument.currentPrice + 0.01));
  }

  const stop = instrument.vwap ?? instrument.dayLow ?? instrument.previousLow ?? instrument.currentPrice * 0.99;

  return money(Math.min(stop, instrument.currentPrice - 0.01));
}

function money(value: number) {
  return Number(value.toFixed(2));
}
