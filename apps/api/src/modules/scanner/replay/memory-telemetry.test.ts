import { describe, expect, it } from "vitest";
import { createMemoryTelemetry, evaluateMemorySafety } from "./memory-telemetry";
import { DEFAULT_WALK_FORWARD_CONFIG, walkForwardRunId } from "./walk-forward";

describe("Phase 8E memory telemetry", () => {
  const lowRss = createMemoryTelemetry({ heapUsed: 1_100, heapTotal: 1_500, rss: 418, external: 12, arrayBuffers: 4 }, { heapSizeLimit: 2_250 });

  it("preserves raw values and accepts logical heap use above RSS", () => {
    expect(lowRss.bytes).toMatchObject({ heapUsed: 1_100, rss: 418, heapSizeLimit: 2_250 });
    expect(lowRss.heapUtilization).toBeCloseTo(1_100 / 2_250);
    expect(lowRss.rssIsInformational).toBe(true);
    expect(evaluateMemorySafety({ telemetry: lowRss })).toEqual({ stop: false, reason: null });
  });

  it("classifies high V8 utilization without stopping on a single allocation spike", () => {
    const high = createMemoryTelemetry({ heapUsed: 2_020, heapTotal: 2_100, rss: 600, external: 0, arrayBuffers: 0 }, { heapSizeLimit: 2_250 });
    expect(high.level).toBe("HIGH");
    expect(evaluateMemorySafety({ telemetry: high })).toEqual({ stop: false, reason: null });
  });

  it("stops for concrete retention failures and unrecovered critical V8 heap", () => {
    const critical = createMemoryTelemetry({ heapUsed: 2_160, heapTotal: 2_180, rss: 700, external: 0, arrayBuffers: 0 }, { heapSizeLimit: 2_250 });
    expect(evaluateMemorySafety({ telemetry: critical, fullSnapshots: 1 })).toEqual({ stop: true, reason: "FULL_SNAPSHOT_RETENTION" });
    expect(evaluateMemorySafety({ telemetry: critical, partitionRuntimeReleased: false })).toEqual({ stop: true, reason: "PARTITION_RUNTIME_RETAINED" });
    expect(evaluateMemorySafety({ telemetry: critical, recentHeapUtilizations: [0.96, 0.97] })).toEqual({ stop: true, reason: "UNRECOVERED_CRITICAL_V8_HEAP" });
  });

  it("does not affect the deterministic research identity", () => {
    const metadata = { walkForwardVersion: "8E.1", universe: "U", universeManifestId: "M", datasetIds: { "1m": "A", "5m": "B" }, calendarVersion: "C", casEligibilityVersion: "CAS", interval: "1m" as const, completenessRequirement: "COMPLETE_SESSIONS" as const, parameterMode: "FROZEN_PARAMETERS" as const, strategyVersions: ["breakout:v1"], analyticsVersion: "8D.1", executionAssumptionsVersion: "8C-PAPER-EXECUTION-V1", startingCapital: 100000, config: DEFAULT_WALK_FORWARD_CONFIG, researchRange: { from: "2025-09-18T03:45:00.000Z", to: "2026-09-18T03:45:00.000Z" } };
    expect(walkForwardRunId(metadata)).toBe(walkForwardRunId(metadata));
  });
});
