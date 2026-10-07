import type { ModuleSummary } from "../../common/utils/create-module-summary";
import { mockAnalysisInputs } from "./mock-data";
import type {
  AiPriceData,
  AiScannerAnalysisInput,
  AiScannerAnalysisOutput,
  ConfidenceLabel,
  SuggestedAction
} from "./types";

export interface AiAnalysisService {
  listInsights: () => Promise<AiScannerAnalysisOutput[]>;
  analyzeScannerOutput: (input: AiScannerAnalysisInput) => Promise<AiScannerAnalysisOutput>;
  getSummary: () => ModuleSummary;
}

export class MockAiAnalysisService implements AiAnalysisService {
  async listInsights() {
    return mockAnalysisInputs.map((input) => this.createAnalysis(input));
  }

  async analyzeScannerOutput(input: AiScannerAnalysisInput) {
    return this.createAnalysis(input);
  }

  private createAnalysis(input: AiScannerAnalysisInput): AiScannerAnalysisOutput {
    const suggestedAction = this.getSuggestedAction(input);
    const confidenceLabel = this.getConfidenceLabel(input, suggestedAction);
    const invalidation = formatPrice(input.riskData.invalidationLevel);

    return {
      summary: `${input.symbol.toUpperCase()}: ${input.direction.toLowerCase()} scan at ${input.score}/100. ${formatAction(suggestedAction)} Invalidation: ${invalidation}. No outcome is guaranteed.`,
      reasons: this.buildReasons(input),
      risks: this.buildRisks(input),
      suggestedAction,
      confidenceLabel
    };
  }

  private buildReasons(input: AiScannerAnalysisInput) {
    const reasons = [`Scanner direction is ${input.direction} with score ${input.score}/100.`];

    if (input.signals.length > 0) {
      reasons.push(`Matched signals: ${input.signals.join(", ")}.`);
    } else {
      reasons.push("No scanner signals were supplied.");
    }

    const priceContext = formatPriceContext(input.priceData);

    if (priceContext) {
      reasons.push(`Provided price context: ${priceContext}.`);
    }

    return reasons.slice(0, 3);
  }

  private buildRisks(input: AiScannerAnalysisInput) {
    const risks = [`Invalidation level is ${formatPrice(input.riskData.invalidationLevel)}.`];

    if (input.riskData.maxLoss !== undefined) {
      risks.push(`Max loss from risk data is ${formatMoney(input.riskData.maxLoss)}.`);
    } else {
      risks.push("Max loss was not supplied in risk data.");
    }

    if (input.riskData.rewardToRiskRatio !== undefined && input.riskData.rewardToRiskRatio < 1) {
      risks.push(`Reward-to-risk is below 1.0 (${input.riskData.rewardToRiskRatio.toFixed(2)}).`);
    }

    if (input.riskData.rejectionReasons?.length) {
      risks.push(`Risk flags: ${input.riskData.rejectionReasons.join(", ")}.`);
    }

    return risks.slice(0, 4);
  }

  private getSuggestedAction(input: AiScannerAnalysisInput): SuggestedAction {
    if (input.riskData.rejectionReasons?.length) {
      return "REVIEW_RISK_FIRST";
    }

    if (input.direction === "NEUTRAL" || input.score < 50 || input.signals.length === 0) {
      return "WAIT";
    }

    if (input.score < 65) {
      return "SKIP";
    }

    return input.direction === "BULLISH" ? "WATCH_FOR_LONG_SETUP" : "WATCH_FOR_SHORT_SETUP";
  }

  private getConfidenceLabel(input: AiScannerAnalysisInput, suggestedAction: SuggestedAction): ConfidenceLabel {
    if (suggestedAction === "REVIEW_RISK_FIRST" || input.score < 50 || input.signals.length === 0) {
      return "LOW";
    }

    if (input.score >= 75 && input.signals.length >= 3) {
      return "HIGH";
    }

    return "MEDIUM";
  }

  getSummary(): ModuleSummary {
    const analyses = mockAnalysisInputs.map((input) => this.createAnalysis(input));

    return {
      key: "ai-analysis",
      title: "AI Analysis",
      description: "Scanner-only analysis explains provided signals, risk, invalidation, and confidence without inventing data.",
      status: "Guarded",
      metrics: [
        { label: "Analyses", value: String(analyses.length) },
        { label: "High confidence", value: `${analyses.filter((analysis) => analysis.confidenceLabel === "HIGH").length}` }
      ]
    };
  }
}

export const aiAnalysisService = new MockAiAnalysisService();

function formatPriceContext(priceData: AiPriceData) {
  const fields = [
    ["current", priceData.currentPrice],
    ["open", priceData.openPrice],
    ["previous close", priceData.previousClose],
    ["day high", priceData.dayHigh],
    ["day low", priceData.dayLow],
    ["VWAP", priceData.vwap]
  ]
    .filter(([, value]) => value !== undefined)
    .map(([label, value]) => `${label} ${formatPrice(Number(value))}`);

  if (priceData.currentVolume !== undefined && priceData.averageVolume !== undefined) {
    fields.push(`volume ${priceData.currentVolume}/${priceData.averageVolume}`);
  }

  return fields.join(", ");
}

function formatAction(action: SuggestedAction) {
  const labels: Record<SuggestedAction, string> = {
    WATCH_FOR_LONG_SETUP: "Watch for a long setup; wait for confirmation.",
    WATCH_FOR_SHORT_SETUP: "Watch for a short setup; wait for confirmation.",
    WAIT: "Wait for a cleaner setup.",
    SKIP: "Skip unless the setup improves.",
    REVIEW_RISK_FIRST: "Review risk before considering action."
  };

  return labels[action];
}

function formatPrice(value: number) {
  return `$${value.toFixed(2)}`;
}

function formatMoney(value: number) {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
