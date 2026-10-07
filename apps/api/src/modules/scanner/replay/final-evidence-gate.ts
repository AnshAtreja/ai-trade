import { researchContentHash } from "./robustness";

export const FINAL_GATE_VERSION = "PHASE_8F4_FINAL_EVIDENCE_GATE_V1";
export const BASELINE_RUN_ID = "1fd46d5ef1f0e98f";
export const FINAL_GATE_STRATEGIES = ["breakout:v1", "breakdown:v1", "momentum:v1", "opening-momentum:v1"] as const;
export type FinalGateStrategy = typeof FINAL_GATE_STRATEGIES[number];

const prefix = "apps/artifacts";
export const FINAL_GATE_SOURCES = {
  baseline8e: { path: `${prefix}/phase8e/frozen-baseline-2026-09-19-final.compact.result.json`, sha256: "8070a2f7e6e1c23aafc9cf801d385b2aa064cd004cdfb298e9214594de23c852" },
  validation8f1: { path: `${prefix}/phase8f/baseline-validation-1fd46d5ef1f0e98f.json`, sha256: "0a645dc5d987fde35788a17932d03df654bef711686fabc5406d417b058cfb3f" },
  robustness8f2: { path: `${prefix}/phase8f/robustness-1fd46d5ef1f0e98f-v1-classification-recovered.json`, sha256: "6b505345eec692f1d8b04eb5873cf8220b6ec49c0fc5974dccb38113962999e9", contentHash: "2e54222b0d12c365beae6659f2dfc999b4fbde9140be9383e32461d3288c9f11" },
  optimization8f3: { path: `${prefix}/phase8f/controlled-optimization-1fd46d5ef1f0e98f-v1.result.json`, sha256: "acc82facf22a0c3cc3bd59dfd476dbc1e19858ffc3f41dcbd6451e2948a4f6b3", contentHash: "1af9eeb9148603581258f09114329050ef0a065308bed7b2efd4031285636a58" },
  train8f3: { path: `${prefix}/phase8f/controlled-optimization-1fd46d5ef1f0e98f-v1.train.json`, sha256: "8eb389204990793403c8d2e91a9d050359de9a6c294a3fae1bde754f4f913cc1" },
  shortlist8f3: { path: `${prefix}/phase8f/controlled-optimization-1fd46d5ef1f0e98f-v1.shortlist.json`, sha256: "40534fc444600c14d4754dc556f5dfb1c73451ece0e41299e8a35791c31900df" },
  validation8f3: { path: `${prefix}/phase8f/controlled-optimization-1fd46d5ef1f0e98f-v1.validation.json`, sha256: "2b1f005997d2459e00598af36d5635c5c126e4b7480b0c87bb9c6fe84822c218" }
} as const;

export type SourceName = keyof typeof FINAL_GATE_SOURCES;
export type ArtifactInputs = Record<SourceName, { sha256: string; data: any }>;

export interface FinalGateSpec {
  version: typeof FINAL_GATE_VERSION;
  baselineRunId: typeof BASELINE_RUN_ID;
  sources: typeof FINAL_GATE_SOURCES;
  rules: {
    baselineRetention: "RETAIN_ONLY_WHEN_ALL_SOURCES_VALIDATE";
    successor: "REQUIRE_SEPARATELY_VERSIONED_AND_VALIDATED_SUCCESSOR";
    noActivity: "ZERO_TEST_TRADES_AND_NO_VIABLE_ACTIVITY_CANDIDATE";
    furtherResearch: "POSITIVE_TEST_NET_WITH_POSITIVE_FROZEN_COST_SCENARIOS_AND_8F1_LOW_SAMPLE_STATUS";
    negativeOrInconsistent: "NONPOSITIVE_TEST_NET_OR_MULTIPLE_NEGATIVE_TEST_FOLDS";
    deploymentEvidence: { minimumTestTrades: 30; maximumNegativeExpectancyFolds: 1; maximumLocallySensitiveGroups: 0; description: "Conservative Phase 8 research gate, not a universal statistical threshold" };
    nextAction: { noActivity: "STRATEGY_REDESIGN_REQUIRED"; furtherResearch: "CONTEXT_FEATURE_RESEARCH"; other: "PRESERVE_AS_COMPARATOR_ONLY" };
    noNewResearch: { historicalReplayExecutions: 0; parameterSearchExecutions: 0; optimizedTestExecutions: 0 };
  };
}

export function buildFinalGateSpec(): FinalGateSpec {
  return {
    version: FINAL_GATE_VERSION,
    baselineRunId: BASELINE_RUN_ID,
    sources: FINAL_GATE_SOURCES,
    rules: {
      baselineRetention: "RETAIN_ONLY_WHEN_ALL_SOURCES_VALIDATE",
      successor: "REQUIRE_SEPARATELY_VERSIONED_AND_VALIDATED_SUCCESSOR",
      noActivity: "ZERO_TEST_TRADES_AND_NO_VIABLE_ACTIVITY_CANDIDATE",
      furtherResearch: "POSITIVE_TEST_NET_WITH_POSITIVE_FROZEN_COST_SCENARIOS_AND_8F1_LOW_SAMPLE_STATUS",
      negativeOrInconsistent: "NONPOSITIVE_TEST_NET_OR_MULTIPLE_NEGATIVE_TEST_FOLDS",
      deploymentEvidence: { minimumTestTrades: 30, maximumNegativeExpectancyFolds: 1, maximumLocallySensitiveGroups: 0, description: "Conservative Phase 8 research gate, not a universal statistical threshold" },
      nextAction: { noActivity: "STRATEGY_REDESIGN_REQUIRED", furtherResearch: "CONTEXT_FEATURE_RESEARCH", other: "PRESERVE_AS_COMPARATOR_ONLY" },
      noNewResearch: { historicalReplayExecutions: 0, parameterSearchExecutions: 0, optimizedTestExecutions: 0 }
    }
  };
}

function requireEvidence(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Phase 8F.4 source validation failed: ${message}`);
}

function sourceContentHash(value: any) {
  const { researchContentSha256: _, operationalTelemetry: __, ...content } = value;
  return researchContentHash(content);
}

function uniqueSize<T>(items: T[]) { return new Set(items).size; }

export function validateFinalGateSources(spec: FinalGateSpec, inputs: ArtifactInputs) {
  requireEvidence(researchContentHash(spec) === researchContentHash(buildFinalGateSpec()), "frozen gate spec changed");
  for (const name of Object.keys(spec.sources) as SourceName[]) {
    requireEvidence(inputs[name]?.sha256 === spec.sources[name].sha256, `${name} file SHA-256 mismatch`);
  }
  const baseline = inputs.baseline8e.data;
  const validation = inputs.validation8f1.data;
  const robustness = inputs.robustness8f2.data;
  const optimization = inputs.optimization8f3.data;
  const train = inputs.train8f3.data;
  const shortlist = inputs.shortlist8f3.data;
  const selected = inputs.validation8f3.data;
  requireEvidence(baseline.runId === spec.baselineRunId && baseline.partitions?.length === 48 && baseline.folds?.length === 4 && baseline.testAggregates?.length === 4, "8E run or fold matrix");
  requireEvidence(baseline.metadata?.universeManifestId === "feaabc0198432edc" && baseline.metadata?.datasetIds?.["1m"] === "505dca3f27301e72" && baseline.metadata?.datasetIds?.["5m"] === "535e2347e56143d9" && baseline.metadata?.calendarVersion === "NSE_CASH_2025_2026_V2" && baseline.metadata?.casEligibilityVersion === "NSE_CAS_ELIGIBILITY_2026_V2" && baseline.metadata?.parameterMode === "FROZEN_PARAMETERS", "8E frozen research identity");
  requireEvidence(uniqueSize(baseline.partitions.map((row: any) => `${row.strategy}|${row.foldId}|${row.partition}`)) === 48, "duplicate 8E partitions");
  requireEvidence(FINAL_GATE_STRATEGIES.every((strategy) => baseline.testAggregates.some((row: any) => row.strategy === strategy) && ["TRAIN", "VALIDATION", "TEST"].every((partition) => baseline.partitions.filter((row: any) => row.strategy === strategy && row.partition === partition).length === 4)), "8E strategy partitions");
  requireEvidence(validation.source?.sha256 === spec.sources.baseline8e.sha256 && validation.source?.runId === spec.baselineRunId && validation.source?.verified === true && validation.source?.resultPartitions === 48 && validation.testTable?.length === 16, "8F.1 source link or TEST matrix");
  requireEvidence(researchContentHash(validation.frozenIdentity) === researchContentHash(baseline.metadata) && uniqueSize(validation.testTable.map((row: any) => `${row.strategy}|${row.foldId}`)) === 16, "8F.1 frozen identity or duplicate TEST rows");
  requireEvidence(FINAL_GATE_STRATEGIES.every((strategy) => validation.byStrategy?.[strategy] && validation.statuses?.[strategy] && validation.testTable.filter((row: any) => row.strategy === strategy).length === 4), "8F.1 strategy evidence");
  requireEvidence(validation.testTable.every((row: any) => {
    const partition = baseline.partitions.find((item: any) => item.strategy === row.strategy && item.foldId === row.foldId && item.partition === "TEST");
    return partition && row.trades === partition.metrics.closedTrades && Math.abs(row.netPnl - partition.metrics.netPnl) < 0.000001;
  }), "8E/8F.1 TEST partition values");
  requireEvidence(robustness.researchContentSha256 === spec.sources.robustness8f2.contentHash && sourceContentHash(robustness) === robustness.researchContentSha256, "8F.2 research content hash");
  requireEvidence(robustness.baselineRunId === spec.baselineRunId && robustness.specVersion === "PHASE_8F2_ROBUSTNESS_V1" && robustness.specHash === "2de2b491c64f3d223d4e402a43914b070d9a61cc8d010435e41215d6e46ec445", "8F.2 experiment identity");
  requireEvidence(robustness.parameterResults?.length === 768 && robustness.costResults?.length === 96 && robustness.parameterClassifications?.length === 24 && robustness.recovery?.rowsRecovered === 576 && robustness.recovery?.zeroTradeBreakdownRows === 192, "8F.2 result counts");
  requireEvidence(robustness.parameterClassifications.filter((row: any) => row.status === "LOCALLY_SENSITIVE").length === 18 && robustness.parameterClassifications.filter((row: any) => row.status === "INSUFFICIENT_ACTIVITY").length === 6, "8F.2 parameter classifications");
  requireEvidence(robustness.noLeakageAudit?.perturbedParameterTestExecutions === 0 && robustness.noLeakageAudit?.recoveryTestExecutions === 0 && robustness.noLeakageAudit?.parameterCostCombinations === 0, "8F.2 leakage audit");
  requireEvidence(robustness.parameterResults.every((row: any) => row.partition === "TRAIN" || row.partition === "VALIDATION") && uniqueSize(robustness.parameterResults.map((row: any) => `${row.variantId}|${row.foldId}|${row.partition}`)) === 768, "8F.2 parameter partitions");
  requireEvidence(robustness.costResults.every((row: any) => row.partition === "TEST") && uniqueSize(robustness.costResults.map((row: any) => `${row.strategy}|${row.foldId}|${row.scenario}`)) === 96, "8F.2 cost scenario matrix");
  for (const strategy of FINAL_GATE_STRATEGIES) {
    const groups = robustness.parameterClassifications.filter((row: any) => row.strategy === strategy);
    requireEvidence(groups.length === 6 && uniqueSize(groups.map((row: any) => row.parameter)) === 6 && groups.every((row: any) => row.rows === 32), `${strategy} parameter groups`);
    requireEvidence(robustness.parameterResults.filter((row: any) => row.strategy === strategy).length === 192, `${strategy} parameter rows`);
    const scenarioRows = robustness.costResults.filter((row: any) => row.strategy === strategy);
    requireEvidence(scenarioRows.length === 24 && researchContentHash([...new Set(scenarioRows.map((row: any) => row.scenario))].sort()) === researchContentHash(["C0", "C1", "C2", "CS1", "S1", "S2"]), `${strategy} cost scenarios`);
    const aggregate = baseline.testAggregates.find((row: any) => row.strategy === strategy);
    const first = validation.byStrategy[strategy];
    requireEvidence(first.totalTrades === aggregate.testTrades && first.negativeExpectancyFolds === aggregate.negativeExpectancyFolds, `${strategy} 8E/8F.1 mismatch`);
    const c0 = scenarioRows.filter((row: any) => row.scenario === "C0");
    requireEvidence(c0.length === 4 && Math.abs(c0.reduce((sum: number, row: any) => sum + row.metrics.netPnl, 0) - aggregate.netPnl) < 0.000001 && c0.reduce((sum: number, row: any) => sum + row.metrics.closedTrades, 0) === aggregate.testTrades, `${strategy} cost baseline mismatch`);
  }
  requireEvidence(optimization.researchContentSha256 === spec.sources.optimization8f3.contentHash && sourceContentHash(optimization) === optimization.researchContentSha256, "8F.3 research content hash");
  requireEvidence(optimization.baselineRunId === spec.baselineRunId && optimization.source8f2Sha256 === spec.sources.robustness8f2.sha256 && optimization.specHash === "89d84e2f98d8daeb5eddcb5c1c9d5e5f6e940cc5c25df64a08847baadf6daa20", "8F.3 source identity");
  requireEvidence(optimization.counts?.optimizationTrainExecutions === 800 && optimization.counts?.selectionValidationExecutions === 60 && optimization.counts?.optimizedCandidateTestExecutions === 0 && optimization.noTestAudit?.optimizedCandidateTestExecutions === 0 && optimization.noTestAudit?.sourcePhase8f2TestDataUsedForSelection === false, "8F.3 execution and no-TEST counts");
  requireEvidence(train.researchContentSha256 === optimization.trainHash && sourceContentHash(train) === train.researchContentSha256 && train.rows?.length === 800 && train.specHash === optimization.specHash, "8F.3 TRAIN artifact");
  requireEvidence(shortlist.researchContentSha256 === optimization.shortlistHash && sourceContentHash(shortlist) === shortlist.researchContentSha256 && shortlist.shortlist?.length === 15 && shortlist.specHash === optimization.specHash && shortlist.trainResearchContentSha256 === optimization.trainHash, "8F.3 frozen shortlist");
  requireEvidence(selected.researchContentSha256 === optimization.validationHash && sourceContentHash(selected) === selected.researchContentSha256 && selected.rows?.length === 60 && selected.shortlistHash === optimization.shortlistHash && selected.specHash === optimization.specHash, "8F.3 VALIDATION artifact");
  requireEvidence(train.rows.every((row: any) => row.partition === "TRAIN") && selected.rows.every((row: any) => row.partition === "VALIDATION"), "8F.3 partition leakage");
  requireEvidence(uniqueSize(train.rows.map((row: any) => `${row.candidateId}|${row.foldId}`)) === 800 && uniqueSize(selected.rows.map((row: any) => `${row.candidateId}|${row.foldId}`)) === 60, "8F.3 duplicate candidate-fold rows");
  requireEvidence(optimization.decisions?.length === 4 && FINAL_GATE_STRATEGIES.every((strategy) => optimization.decisions.some((row: any) => row.strategy === strategy)), "8F.3 strategy decisions");
  requireEvidence(optimization.decisions.every((row: any) => row.selectedForFinalGate?.length === 0 && row.frozenShortlist?.length === row.validation?.length), "8F.3 successor or shortlist mismatch");
  requireEvidence(optimization.decisions.every((row: any) => row.status === (row.strategy === "breakdown:v1" ? "BREAKDOWN_NO_VIABLE_ACTIVITY" : "NO_ACCEPTABLE_CANDIDATE")), "8F.3 final outcomes");
  requireEvidence(optimization.decisions.reduce((sum: number, row: any) => sum + row.trainCandidatesEvaluated * 4, 0) === 800 && optimization.decisions.reduce((sum: number, row: any) => sum + row.validation.length * 4, 0) === 60, "8F.3 decision counts");
  return true;
}

export interface StrategyGateEvidence {
  strategy: FinalGateStrategy;
  baselineRetention: "RETAIN_RESEARCH_BASELINE";
  validatedSuccessor: "NO_VALIDATED_SUCCESSOR";
  standaloneEvidenceStatus: "NO_ACTIVITY_EVIDENCE" | "EVIDENCE_SUPPORTS_FURTHER_RESEARCH" | "NEGATIVE_OR_INCONSISTENT_BASELINE_EVIDENCE" | "INSUFFICIENT_EVIDENCE_FOR_DEPLOYMENT";
  deploymentEvidence: "INSUFFICIENT_EVIDENCE_FOR_DEPLOYMENT";
  deploymentEvidenceReasons: string[];
  nextResearchAction: "STRATEGY_REDESIGN_REQUIRED" | "CONTEXT_FEATURE_RESEARCH" | "PRESERVE_AS_COMPARATOR_ONLY";
  walkForward: { testFolds: number; testTrades: number; positiveExpectancyFolds: number; negativeExpectancyFolds: number; netPnl: number; expectancy: number | null; profitFactor: number | null; maxDrawdown: number; foldNetPnl: Array<{ foldId: string; trades: number; netPnl: number }> };
  frozenBaselineValidation: { status: string; verySmallSampleFolds: number; topPositiveSector: { sector: string; tradeCount: number; netPnl: number } | null };
  robustness: { parameterGroups: number; locallySensitiveGroups: number; insufficientActivityGroups: number; costScenarios: Array<{ scenario: string; folds: number; closedTrades: number; netPnl: number }> };
  optimization: { trainCandidatesEvaluated: number; trainCandidatesSurviving: number; frozenShortlistCount: number; validationCandidatesEvaluated: number; validationFailureReasons: Record<string, number>; outcome: string; selectedSuccessors: number };
}

export function classifyStrategy(evidence: Pick<StrategyGateEvidence, "walkForward" | "frozenBaselineValidation" | "robustness" | "optimization">, rules: FinalGateSpec["rules"]): Pick<StrategyGateEvidence, "standaloneEvidenceStatus" | "deploymentEvidence" | "deploymentEvidenceReasons" | "nextResearchAction"> {
  const { walkForward: test, robustness, optimization, frozenBaselineValidation } = evidence;
  const allCostsPositive = robustness.costScenarios.every((scenario) => scenario.netPnl > 0);
  let standaloneEvidenceStatus: StrategyGateEvidence["standaloneEvidenceStatus"];
  if (test.testTrades === 0 && optimization.outcome === "BREAKDOWN_NO_VIABLE_ACTIVITY") standaloneEvidenceStatus = "NO_ACTIVITY_EVIDENCE";
  else if (test.netPnl > 0 && allCostsPositive && frozenBaselineValidation.status === "POSITIVE_OOS_BUT_LOW_SAMPLE_AND_MIXED_FOLD_EVIDENCE") standaloneEvidenceStatus = "EVIDENCE_SUPPORTS_FURTHER_RESEARCH";
  else if (test.netPnl <= 0 || test.negativeExpectancyFolds >= 2) standaloneEvidenceStatus = "NEGATIVE_OR_INCONSISTENT_BASELINE_EVIDENCE";
  else standaloneEvidenceStatus = "INSUFFICIENT_EVIDENCE_FOR_DEPLOYMENT";
  const deploymentEvidenceReasons = [
    ...(test.testTrades < rules.deploymentEvidence.minimumTestTrades ? ["SMALL_TEST_TRADE_SAMPLE"] : []),
    ...(test.negativeExpectancyFolds > rules.deploymentEvidence.maximumNegativeExpectancyFolds ? ["INCONSISTENT_TEST_FOLDS"] : []),
    ...(robustness.locallySensitiveGroups > rules.deploymentEvidence.maximumLocallySensitiveGroups ? ["LOCAL_PARAMETER_SENSITIVITY"] : []),
    ...(test.testTrades === 0 ? ["NO_TEST_ACTIVITY"] : [])
  ];
  requireEvidence(deploymentEvidenceReasons.length > 0, "deployment evidence needs a separately reviewed gate");
  const nextResearchAction = standaloneEvidenceStatus === "NO_ACTIVITY_EVIDENCE" ? rules.nextAction.noActivity : standaloneEvidenceStatus === "EVIDENCE_SUPPORTS_FURTHER_RESEARCH" ? rules.nextAction.furtherResearch : rules.nextAction.other;
  return { standaloneEvidenceStatus, deploymentEvidence: "INSUFFICIENT_EVIDENCE_FOR_DEPLOYMENT", deploymentEvidenceReasons, nextResearchAction };
}

export function synthesizeFinalGate(spec: FinalGateSpec, inputs: ArtifactInputs) {
  validateFinalGateSources(spec, inputs);
  const baseline = inputs.baseline8e.data;
  const validation = inputs.validation8f1.data;
  const robustness = inputs.robustness8f2.data;
  const optimization = inputs.optimization8f3.data;
  const matrix: StrategyGateEvidence[] = FINAL_GATE_STRATEGIES.map((strategy) => {
    const aggregate = baseline.testAggregates.find((row: any) => row.strategy === strategy);
    const decision = optimization.decisions.find((row: any) => row.strategy === strategy);
    const groups = robustness.parameterClassifications.filter((row: any) => row.strategy === strategy);
    const costScenarios = [...new Set<string>(robustness.costResults.filter((row: any) => row.strategy === strategy).map((row: any) => String(row.scenario)))].sort().map((scenario) => {
      const rows = robustness.costResults.filter((row: any) => row.strategy === strategy && row.scenario === scenario);
      return { scenario, folds: rows.length, closedTrades: rows.reduce((sum: number, row: any) => sum + row.metrics.closedTrades, 0), netPnl: rows.reduce((sum: number, row: any) => sum + row.metrics.netPnl, 0) };
    });
    const sectors = baseline.sectorBreakdown.filter((row: any) => row.strategy === strategy && row.partition === "TEST" && row.netPnl > 0).sort((a: any, b: any) => b.netPnl - a.netPnl || a.sector.localeCompare(b.sector));
    const validationFailureReasons: Record<string, number> = {};
    for (const candidate of decision.validation) for (const reason of candidate.reasons) validationFailureReasons[reason] = (validationFailureReasons[reason] ?? 0) + 1;
    const partial = {
      walkForward: { testFolds: aggregate.testFolds, testTrades: aggregate.testTrades, positiveExpectancyFolds: aggregate.positiveExpectancyFolds, negativeExpectancyFolds: aggregate.negativeExpectancyFolds, netPnl: aggregate.netPnl, expectancy: aggregate.expectancy, profitFactor: aggregate.profitFactor, maxDrawdown: aggregate.maxDrawdown, foldNetPnl: validation.testTable.filter((row: any) => row.strategy === strategy).map((row: any) => ({ foldId: row.foldId, trades: row.trades, netPnl: row.netPnl })) },
      frozenBaselineValidation: { status: validation.statuses[strategy], verySmallSampleFolds: validation.byStrategy[strategy].verySmallSampleFolds, topPositiveSector: sectors[0] ? { sector: sectors[0].sector, tradeCount: sectors[0].tradeCount, netPnl: sectors[0].netPnl } : null },
      robustness: { parameterGroups: groups.length, locallySensitiveGroups: groups.filter((row: any) => row.status === "LOCALLY_SENSITIVE").length, insufficientActivityGroups: groups.filter((row: any) => row.status === "INSUFFICIENT_ACTIVITY").length, costScenarios },
      optimization: { trainCandidatesEvaluated: decision.trainCandidatesEvaluated, trainCandidatesSurviving: decision.trainCandidatesSurviving, frozenShortlistCount: decision.frozenShortlist.length, validationCandidatesEvaluated: decision.validation.length * 4, validationFailureReasons, outcome: decision.status, selectedSuccessors: decision.selectedForFinalGate.length }
    };
    return { strategy, baselineRetention: "RETAIN_RESEARCH_BASELINE", validatedSuccessor: "NO_VALIDATED_SUCCESSOR", ...partial, ...classifyStrategy(partial, spec.rules) };
  });
  const report = {
    format: "8F4-FINAL-EVIDENCE-GATE-1",
    specVersion: spec.version,
    specHash: researchContentHash(spec),
    baselineRunId: spec.baselineRunId,
    sourceIdentities: Object.fromEntries((Object.keys(spec.sources) as SourceName[]).map((name) => [name, { ...spec.sources[name], ...("researchContentSha256" in inputs[name].data ? { researchContentSha256: inputs[name].data.researchContentSha256 } : {}) }])),
    rules: spec.rules,
    strategyEvidenceMatrix: matrix,
    counts: { retainedResearchBaselines: matrix.length, validatedSuccessors: 0, strategiesRequiringRedesign: matrix.filter((row) => row.nextResearchAction === "STRATEGY_REDESIGN_REQUIRED").length, strategiesWithInsufficientDeploymentEvidence: matrix.filter((row) => row.deploymentEvidence === "INSUFFICIENT_EVIDENCE_FOR_DEPLOYMENT").length },
    phase9Handoff: {
      allowedAssumptions: ["VERSIONED_HISTORICAL_DATA_AND_REPLAY_VALIDATED", "HISTORICAL_EXECUTION_AND_ANALYTICS_VALIDATED", "WALK_FORWARD_AND_ROBUSTNESS_INFRASTRUCTURE_VALIDATED", "CONTROLLED_OPTIMIZATION_COMPLETED_WITH_NO_VALIDATED_SUCCESSOR", "V1_STRATEGIES_RETAINED_AS_RESEARCH_BASELINES"],
      prohibitedAssumptions: ["PROFITABLE_PRODUCTION_STRATEGY", "MOMENTUM_PROVEN_PROFITABLE", "V1_READY_FOR_LIVE_TRADING", "PARAMETER_TUNING_SOLVED_ROBUSTNESS"],
      strategyVersioningRule: "Any material feature, rule, or parameter change requires a new research version and independent evaluation; frozen v1 baselines remain unchanged.",
      ablationRule: "Compare each new context, Kronos, meta-label, or event layer with its identical frozen baseline and report incremental evidence before claiming benefit."
    },
    limitations: ["ONE_YEAR_FROZEN_DATA", "CURRENT_UNIVERSE_SURVIVORSHIP_BIAS", "FOUR_WALK_FORWARD_FOLDS", "SMALL_TEST_TRADE_SAMPLES", "LOCAL_PARAMETER_SENSITIVITY", "FOLD_INSTRUMENT_SECTOR_CONCENTRATION", "NO_VALIDATED_OPTIMIZED_SUCCESSOR", "BREAKDOWN_INACTIVITY", "HISTORICAL_EXECUTION_IS_A_MODEL", "FUTURE_SHADOW_EVIDENCE_REQUIRED", "NO_MARKET_REGIME_OR_KRONOS_OR_META_LABEL_OR_NEWS_INTELLIGENCE"],
    noLeakageAudit: { historicalReplayExecutionsThisGate: 0, parameterSearchExecutionsThisGate: 0, optimizedTestExecutionsThisGate: 0, source8f2PerturbedTestExecutions: robustness.noLeakageAudit.perturbedParameterTestExecutions, source8f3OptimizedTestExecutions: optimization.counts.optimizedCandidateTestExecutions },
    phase8Status: "COMPLETE",
    phase9Status: "PENDING"
  };
  return { ...report, researchContentSha256: researchContentHash(report) };
}
