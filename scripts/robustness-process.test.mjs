import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { inspectProgress } from "./robustness-process.mjs";

const name = "robustness-1fd46d5ef1f0e98f-v1";
test("monitor distinguishes stopped, unknown, live, stale, PID reuse, and completion", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "8f2-monitor-"));
  try {
    assert.equal(inspectProgress(dir, new Map()).status, "STOPPED");
    assert.match(inspectProgress(dir, null).status, /UNKNOWN/);
    const workerPath = path.resolve("apps/api/src/modules/scanner/replay/robustness-worker.ts");
    const requestPath = path.join(dir, "request.json");
    const processes = new Map([[123, { ppid: 1, stat: "R", command: `node --import tsx ${workerPath} --request ${requestPath}` }]]);
    const runtime = { workers: [{ pid: 123, requestPath, lastHeartbeatAt: new Date().toISOString(), progress: { candlesProcessed: 55, totalCandles: 100 } }] };
    writeFileSync(path.join(dir, `${name}.runtime.json`), JSON.stringify(runtime));
    const alive = inspectProgress(dir, processes);
    assert.equal(alive.status, "RUNNING");
    assert.equal(alive.workers[0].processed, 55);
    assert.equal(inspectProgress(dir, processes, Date.now() + 240000).status, "ALIVE, HEARTBEAT STALE");
    runtime.workers[0].progress.lastProgressAt = new Date(Date.now() - 600000).toISOString();
    writeFileSync(path.join(dir, `${name}.runtime.json`), JSON.stringify(runtime));
    assert.equal(inspectProgress(dir, processes).status, "ALIVE, NO RECENT CANDLE PROGRESS");
    assert.equal(inspectProgress(dir, new Map([[123, { stat: "R", command: "node unrelated.js" }]])).status, "STOPPED");
    const final = { format: "8F2-ROBUSTNESS-RESULT-1", specHash: "2de2b491c64f3d223d4e402a43914b070d9a61cc8d010435e41215d6e46ec445", baselineRunId: "1fd46d5ef1f0e98f", counts: { parameterLogicalResults: 768, costScenarioPartitions: 96, perturbedTestExecutions: 0 }, noLeakageAudit: { parameterCostCombinations: 0 }, parameterResults: Array(768).fill({}), costResults: Array(96).fill({}) };
    writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(final));
    assert.equal(inspectProgress(dir, new Map()).status, "COMPLETE");
    final.counts.perturbedTestExecutions = 1;
    writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(final));
    assert.equal(inspectProgress(dir, new Map()).status, "STOPPED");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("counts only matching checkpoints with readable completed results", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "8f2-monitor-"));
  try {
    const checkpointDir = path.join(dir, `${name}-checkpoints`);
    mkdirSync(checkpointDir);
    const identity = { specHash: "2de2b491c64f3d223d4e402a43914b070d9a61cc8d010435e41215d6e46ec445", baselineRunId: "1fd46d5ef1f0e98f", strategy: "momentum:v1", foldId: "fold-01", partition: "TRAIN" };
    const resultPath = path.join(dir, "result.json");
    writeFileSync(resultPath, JSON.stringify({ ...identity, format: "8F2-SHARED-WORKER-1", candles: 5, results: [{ variantId: "a", metrics: { candlesProcessed: 5 } }] }));
    writeFileSync(path.join(checkpointDir, "valid.json"), JSON.stringify({ ...identity, variantIds: ["a"], resultPath }));
    writeFileSync(path.join(checkpointDir, "invalid.json"), JSON.stringify({ ...identity, variantIds: ["b"], resultPath: "missing.json" }));
    const s = inspectProgress(dir, new Map());
    assert.equal(s.parameterResults, 1);
    assert.equal(s.invalid, 1);
    assert.equal(s.status, "STOPPED");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
