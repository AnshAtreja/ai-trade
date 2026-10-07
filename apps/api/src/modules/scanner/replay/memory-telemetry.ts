export interface ProcessMemoryUsageSample {
  heapUsed: number;
  heapTotal: number;
  rss: number;
  external: number;
  arrayBuffers: number;
}

export interface V8HeapStatisticsSample {
  heapSizeLimit: number;
}

export type MemorySafetyLevel = "NORMAL" | "ELEVATED" | "HIGH" | "CRITICAL";

export interface MemoryTelemetry {
  bytes: ProcessMemoryUsageSample & V8HeapStatisticsSample;
  mb: Record<keyof (ProcessMemoryUsageSample & V8HeapStatisticsSample), number>;
  heapUtilization: number;
  level: MemorySafetyLevel;
  /** RSS is physical residency; it can be lower than logical V8 heap use on macOS. */
  rssIsInformational: true;
}

export interface MemorySafetyInput {
  telemetry: MemoryTelemetry;
  recentHeapUtilizations?: number[];
  fullSnapshots?: number;
  partitionRuntimeReleased?: boolean;
}

export function createMemoryTelemetry(processUsage: ProcessMemoryUsageSample, heap: V8HeapStatisticsSample): MemoryTelemetry {
  const bytes = { ...processUsage, heapSizeLimit: heap.heapSizeLimit };
  const heapUtilization = bytes.heapSizeLimit > 0 ? bytes.heapUsed / bytes.heapSizeLimit : 0;
  return {
    bytes,
    mb: Object.fromEntries(Object.entries(bytes).map(([key, value]) => [key, roundMb(value)])) as MemoryTelemetry["mb"],
    heapUtilization,
    level: memorySafetyLevel(heapUtilization),
    rssIsInformational: true
  };
}

export function memorySafetyLevel(heapUtilization: number): MemorySafetyLevel {
  if (heapUtilization >= 0.95) return "CRITICAL";
  if (heapUtilization >= 0.88) return "HIGH";
  if (heapUtilization >= 0.75) return "ELEVATED";
  return "NORMAL";
}

/**
 * A single high allocation sample is not an OOM prediction. A stop requires
 * a concrete failure or high heap utilization that keeps increasing without
 * a meaningful GC recovery.
 */
export function evaluateMemorySafety(input: MemorySafetyInput) {
  if ((input.fullSnapshots ?? 0) > 0) return { stop: true, reason: "FULL_SNAPSHOT_RETENTION" as const };
  if (input.partitionRuntimeReleased === false) return { stop: true, reason: "PARTITION_RUNTIME_RETAINED" as const };
  const history = [...(input.recentHeapUtilizations ?? []), input.telemetry.heapUtilization];
  const trailing = history.slice(-3);
  const unrecoveredCritical = trailing.length === 3 && trailing.every((value) => value >= 0.95) && Math.max(...trailing) - Math.min(...trailing) <= 0.03;
  if (unrecoveredCritical) return { stop: true, reason: "UNRECOVERED_CRITICAL_V8_HEAP" as const };
  return { stop: false, reason: null };
}

function roundMb(bytes: number) {
  return Math.round(bytes / 1024 / 1024 * 100) / 100;
}
