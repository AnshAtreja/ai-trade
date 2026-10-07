import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(script), "..");
const artifacts = path.join(root, "apps/artifacts/phase8f");
const name = "robustness-1fd46d5ef1f0e98f-v1";
const specHash = "2de2b491c64f3d223d4e402a43914b070d9a61cc8d010435e41215d6e46ec445";
const baseline = "1fd46d5ef1f0e98f";
const label = "com.tradepilot.robustness8f2";
const logfile = path.join(artifacts, `${name}.log`);
const coordinator = path.join(root, "apps/api/src/modules/scanner/replay/robustness-experiment-cli.ts");

function readJson(file) { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; } }
function atomic(file, value) { const temp = `${file}.${process.pid}.tmp`; writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 }); renameSync(temp, file); }

export function readProcesses() {
  try {
    const output = execFileSync("ps", ["-axo", "pid=,ppid=,stat=,command="], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
    return new Map(output.trim().split("\n").flatMap(line => {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/);
      return match ? [[Number(match[1]), { ppid: Number(match[2]), stat: match[3], command: match[4] }]] : [];
    }));
  } catch { return null; }
}

export function inspectProgress(directory = artifacts, processes = readProcesses(), now = Date.now()) {
  const runtime = readJson(path.join(directory, `${name}.runtime.json`));
  const final = readJson(path.join(directory, `${name}.json`));
  const complete = final?.format === "8F2-ROBUSTNESS-RESULT-1" && final.specHash === specHash && final.baselineRunId === baseline && final.counts?.parameterLogicalResults === 768 && final.counts?.costScenarioPartitions === 96 && final.counts?.perturbedTestExecutions === 0 && final.noLeakageAudit?.parameterCostCombinations === 0 && final.parameterResults?.length === 768 && final.costResults?.length === 96;
  const batches = new Set(), rows = new Set(), costs = new Set();
  let invalid = 0;
  const checkpointDir = path.join(directory, `${name}-checkpoints`);
  for (const file of existsSync(checkpointDir) ? readdirSync(checkpointDir).filter(f => f.endsWith(".json") && !f.startsWith("smoke")) : []) {
    const cp = readJson(path.join(checkpointDir, file));
    if (cp?.specHash !== specHash || cp.baselineRunId !== baseline) continue;
    const r = cp.resultPath && readJson(cp.resultPath);
    if (!r || r.specHash !== specHash || r.baselineRunId !== baseline || r.strategy !== cp.strategy || cp.resultSha256 && createHash("sha256").update(readFileSync(cp.resultPath)).digest("hex") !== cp.resultSha256) { invalid++; continue; }
    const ids = cp.variantIds ?? cp.completedVariantIds;
    if (ids) {
      if (!["TRAIN", "VALIDATION"].includes(cp.partition) || r.format !== "8F2-SHARED-WORKER-1" || r.foldId !== cp.foldId || r.partition !== cp.partition || r.results?.length !== ids.length || new Set(r.results.map(x => x.variantId)).size !== ids.length || !ids.every(id => r.results.some(x => x.variantId === id && x.metrics?.candlesProcessed === r.candles)) || !(r.candles > 0)) { invalid++; continue; }
      batches.add(`${cp.strategy}/${cp.foldId}/${cp.partition}/${[...ids].sort().join(",")}`);
      for (const id of ids) rows.add(`${cp.foldId}/${cp.partition}/${id}`);
    } else if (cp.category === "COST") {
      if (r.format !== "8F2-COST-WORKER-1" || r.scenario !== cp.scenario || r.partitions?.length !== 1 || r.partitions[0].partition !== "TEST" || r.partitions[0].foldId !== cp.foldId) { invalid++; continue; }
      costs.add(`${cp.strategy}/${cp.foldId}/${cp.scenario}`);
    }
  }
  const relevant = processes && [...processes.entries()].filter(([, p]) => !p.stat.startsWith("Z") && /(?:node|tsx)\s/.test(p.command) && /(?:^|\/)robustness-(?:experiment-cli|worker|cost-worker)\.ts(?:\s|$)/.test(p.command) && (p.command.includes(root) || runtime?.workers?.some(w => p.command.includes(w.requestPath))));
  const coordinators = relevant?.filter(([, p]) => p.command.includes("robustness-experiment-cli.ts")) ?? [];
  const active = relevant?.filter(([, p]) => /robustness-(?:worker|cost-worker)\.ts/.test(p.command)) ?? [];
  const workers = active.map(([pid, p]) => {
    const w = runtime?.workers?.find(w => w.pid === pid && p.command.includes(w.requestPath));
    const progress = w?.progress;
    return { pid, strategy: w?.strategy ?? "unknown", fold: w?.fold, partition: w?.partition ?? "TEST", scenario: w?.scenario, processed: progress?.candlesProcessed ?? progress?.processedCandles, total: progress?.totalCandles, stage: progress?.stage ?? "AWAITING_HEARTBEAT", heartbeatAgeSeconds: w?.lastHeartbeatAt ? Math.round((now - Date.parse(w.lastHeartbeatAt)) / 1000) : null, lastProgressAt: progress?.lastProgressAt, heapMiB: progress?.heapUsed ? Math.round(progress.heapUsed / 1048576) : null };
  });
  const stale = workers.some(w => w.heartbeatAgeSeconds == null || w.heartbeatAgeSeconds > 180);
  const noProgress = workers.some(w => w.total > 0 && w.lastProgressAt && now - Date.parse(w.lastProgressAt) > 300_000);
  const status = complete ? "COMPLETE" : processes === null ? "UNKNOWN (process check failed)" : active.length ? (stale ? "ALIVE, HEARTBEAT STALE" : noProgress ? "ALIVE, NO RECENT CANDLE PROGRESS" : "RUNNING") : coordinators.length ? "COORDINATOR ALIVE, NO ACTIVE WORKER" : "STOPPED";
  return { status, complete, parameterBatches: batches.size, parameterResults: rows.size, costBatches: costs.size, invalid, coordinatorCount: coordinators.length, workers, lastError: runtime?.lastError ?? readJson(path.join(directory, `${name}.supervisor.json`))?.error ?? null };
}

function printProgress(s) {
  console.log(`${new Date().toLocaleString()} | ${s.status} | parameters ${s.parameterResults}/768 (${s.parameterBatches}/96 batches) | costs ${s.costBatches}/80 new + 16 frozen baseline | workers ${s.workers.length}`);
  for (const w of s.workers) {
    const count = w.total ? `${Number(w.processed ?? 0).toLocaleString()}/${Number(w.total).toLocaleString()} (${((w.processed ?? 0) / w.total * 100).toFixed(1)}%)` : "loading";
    console.log(`  PID ${w.pid} ${w.strategy} ${w.fold ?? ""}/${w.partition} ${w.scenario ?? ""}: ${count}; ${w.stage}; heartbeat ${w.heartbeatAgeSeconds ?? "?"}s ago${w.heapMiB ? `; heap ${w.heapMiB} MiB` : ""}`);
  }
  if (s.invalid) console.log(`  Invalid/incomplete checkpoint results: ${s.invalid}`);
  if (s.lastError && s.status !== "RUNNING") console.log(`  Last error: ${s.lastError}`);
}

async function main() {
  const action = process.argv[2] ?? "status";
  if (action === "status" || action === "--watch") {
    const seconds = Number(process.argv[3] ?? 120);
    if (!Number.isFinite(seconds) || seconds < 1) throw new Error("Watch interval must be positive seconds.");
    const tick = () => { const s = inspectProgress(); printProgress(s); return s; };
    const first = tick();
    if (action === "status" || first.complete || first.status === "STOPPED") return;
    const timer = setInterval(() => { const s = tick(); if (s.complete || s.status === "STOPPED") clearInterval(timer); }, seconds * 1000);
    return;
  }
  if (action === "start") {
    const s = inspectProgress();
    if (s.complete) { printProgress(s); return; }
    if (s.status !== "STOPPED") throw new Error(`Refusing a duplicate or unverifiable launch: ${s.status}`);
    if (process.platform !== "darwin") throw new Error("Supervised launch currently supports macOS only. Run the npm coordinator in your terminal on other platforms.");
    mkdirSync(artifacts, { recursive: true });
    let prior;
    try { prior = execFileSync("launchctl", ["list", label], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch {}
    if (prior) {
      if (/"PID"\s*=\s*\d+/.test(prior)) throw new Error("The existing research supervisor is still alive.");
      execFileSync("launchctl", ["remove", label]);
    }
    execFileSync("launchctl", ["submit", "-l", label, "-o", logfile, "-e", logfile, "--", process.execPath, script, "supervise"]);
    console.log(`Submitted checkpoint resume to macOS launchd. Log: ${logfile}`);
    return;
  }
  if (action === "supervise") {
    const stateFile = path.join(artifacts, `${name}.supervisor.json`);
    const state = { pid: process.pid, startedAt: new Date().toISOString(), state: "STARTING", coordinatorPid: null, exitCode: null, signal: null, error: null };
    atomic(stateFile, state);
    const child = spawn(process.execPath, ["--import", "tsx", coordinator], { cwd: path.join(root, "apps/api"), stdio: "inherit", env: { ...process.env, PATH: `${path.dirname(process.execPath)}:${process.env.PATH ?? "/usr/bin:/bin"}` } });
    state.coordinatorPid = child.pid;
    state.state = "RUNNING";
    atomic(stateFile, state);
    child.once("error", error => { state.state = "FAILED"; state.error = error.message; atomic(stateFile, state); process.exitCode = 1; });
    child.once("close", (code, signal) => {
      state.state = code === 0 ? "EXITED" : "FAILED"; state.exitCode = code; state.signal = signal;
      if (code !== 0) state.error = `Coordinator exited: code=${code}, signal=${signal}`;
      atomic(stateFile, { ...state, exitedAt: new Date().toISOString() });
      process.exitCode = code === 0 ? 0 : 1;
    });
    return;
  }
  throw new Error("Usage: node scripts/robustness-process.mjs [start|status|--watch 120]");
}

if (process.argv[1] && path.resolve(process.argv[1]) === script) main().catch(error => { console.error(error.message); process.exitCode = 1; });
