import { createHash } from "node:crypto";
import { adaptPhase8F2ClassificationMetrics, durableClassificationMetrics, type Phase8F2DurableClassificationMetrics } from "./robustness";
import type { HistoricalPaperExecutionResult } from "./historical-paper-execution";

export const PHASE_8F2_CLASSIFICATION_RECOVERY_SCHEMA = "8F2-CLASSIFICATION-RECOVERY-1";

export interface Phase8F2ParameterRowIdentity {
  specHash: string;
  baselineRunId: string;
  strategy: string;
  foldId: string;
  partition: "TRAIN" | "VALIDATION";
  variantId: string;
}

export interface Phase8F2LegacyExecutionMetrics {
  positionsClosed: number;
  ordersFilled: number;
  grossPnl: number;
  charges: number;
  netPnl: number;
}

export interface Phase8F2ClassificationRecoveryRow {
  schemaVersion: typeof PHASE_8F2_CLASSIFICATION_RECOVERY_SCHEMA;
  recoveryIdentity: string;
  sourceIdentity: Phase8F2ParameterRowIdentity;
  classificationMetrics: Phase8F2DurableClassificationMetrics;
}

/**
 * Adds only classification inputs to an existing result identity. The caller must
 * first prove that all original persisted execution values match exactly.
 */
export function buildClassificationRecoveryRow(
  sourceIdentity: Phase8F2ParameterRowIdentity,
  existing: Phase8F2LegacyExecutionMetrics,
  recovered: HistoricalPaperExecutionResult,
  maxDrawdownAmount: number
): Phase8F2ClassificationRecoveryRow {
  const summary = recovered.summary;
  const mismatches = [
    ["positionsClosed", existing.positionsClosed, summary.positionsClosed],
    ["ordersFilled", existing.ordersFilled, summary.ordersFilled],
    ["grossPnl", existing.grossPnl, summary.grossPnl],
    ["charges", existing.charges, summary.charges],
    ["netPnl", existing.netPnl, summary.netPnl]
  ].filter(([, expected, actual]) => expected !== actual);
  if (mismatches.length) throw new Error(`Phase 8F.2 recovery changed persisted metrics: ${mismatches.map(([name]) => name).join(", ")}.`);

  const classificationMetrics = durableClassificationMetrics(summary, maxDrawdownAmount);
  adaptPhase8F2ClassificationMetrics(classificationMetrics);
  const recoveryIdentity = createHash("sha256")
    .update(JSON.stringify({ schemaVersion: PHASE_8F2_CLASSIFICATION_RECOVERY_SCHEMA, sourceIdentity }))
    .digest("hex");
  return { schemaVersion: PHASE_8F2_CLASSIFICATION_RECOVERY_SCHEMA, recoveryIdentity, sourceIdentity, classificationMetrics };
}
