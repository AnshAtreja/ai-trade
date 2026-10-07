import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(script), "..");
const artifactRoot = path.join(root, "apps/artifacts/phase8f");
const name = "controlled-optimization-1fd46d5ef1f0e98f-v1";
const label = "com.tradepilot.controlled-optimization8f3";
const coordinator = path.join(root, "apps/api/src/modules/scanner/replay/controlled-optimization-cli.ts");
const specPath = path.join(artifactRoot, `${name}.spec.json`);
const proofPath = path.join(artifactRoot, `${name}.proof.json`);
const diagnosticPath = path.join(artifactRoot, `${name}.breakdown-diagnostic.json`);
const resultPath = path.join(artifactRoot, `${name}.result.json`);
const runtimePath = path.join(artifactRoot, `${name}.runtime.json`);
const supervisorPath = path.join(artifactRoot, `${name}.supervisor.json`);
const checkpointRoot = path.join(artifactRoot, `${name}-checkpoints`);
const logPath = path.join(artifactRoot, `${name}.log`);

function readJson(file) { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; } }
function atomic(file, value) { const temporary = `${file}.${process.pid}.tmp`; writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 }); renameSync(temporary, file); }
function alive(pid) { if (!Number.isInteger(pid)) return false; try { process.kill(pid, 0); return true; } catch { return false; } }

function status() {
  const spec = readJson(specPath);
  const proof = readJson(proofPath);
  const diagnostic = readJson(diagnosticPath);
  const result = readJson(resultPath);
  const runtime = readJson(runtimePath);
  const supervisor = readJson(supervisorPath);
  const checkpoints = existsSync(checkpointRoot) ? readdirSync(checkpointRoot).filter((file) => file.endsWith(".checkpoint.json")) : [];
  const trainBatches = checkpoints.filter((file) => file.startsWith("search-")).length;
  const validationBatches = checkpoints.filter((file) => file.startsWith("selection-")).length;
  const workers = (runtime?.workers ?? []).filter((worker) => worker.state === "RUNNING" && alive(worker.pid)).map((worker) => ({
    pid: worker.pid, strategy: worker.strategy, fold: worker.fold, partition: worker.partition,
    candidates: worker.candidateIds?.length ?? 0,
    stage: worker.progress?.stage ?? "STARTING",
    candles: worker.progress?.candlesProcessed ?? 0,
    total: worker.progress?.totalCandles ?? 0,
    heartbeatAgeSeconds: worker.lastHeartbeatAt ? Math.round((Date.now() - Date.parse(worker.lastHeartbeatAt)) / 1000) : null,
    rssMiB: worker.progress?.rss ? Math.round(worker.progress.rss / 1048576) : null
  }));
  const complete = result?.format === "8F3-CONTROLLED-OPTIMIZATION-RESULT-1" && result.specHash === spec?.specHash && result.counts?.optimizationTrainExecutions === 800 && result.counts?.optimizedCandidateTestExecutions === 0;
  const running = alive(runtime?.coordinatorPid) || alive(supervisor?.pid);
  return { state: complete ? "COMPLETE" : running ? "RUNNING" : "STOPPED", specHash: spec?.specHash ?? null, proof: proof?.sharedVsIsolated ?? null, diagnostic: Boolean(diagnostic?.funnel), trainBatches, trainPlanned: 100, trainExecutions: trainBatches * 8, validationBatches, workers, lastError: runtime?.lastError ?? supervisor?.error ?? null, resultPath: complete ? resultPath : null };
}

function print(s) {
  console.log(`${new Date().toLocaleString()} | ${s.state} | TRAIN ${s.trainBatches}/${s.trainPlanned} batches (${s.trainExecutions}/800 evaluations) | VALIDATION ${s.validationBatches} batches | workers ${s.workers.length}`);
  for (const worker of s.workers) console.log(`  PID ${worker.pid} ${worker.strategy} ${worker.fold}/${worker.partition}: ${worker.candles.toLocaleString()}/${worker.total.toLocaleString()} candles (${worker.total ? (100 * worker.candles / worker.total).toFixed(1) : "0.0"}%); ${worker.stage}; heartbeat ${worker.heartbeatAgeSeconds ?? "?"}s; RSS ${worker.rssMiB ?? "?"} MiB`);
  if (s.lastError) console.log(`  Last error: ${s.lastError}`);
  if (s.resultPath) console.log(`  Result: ${s.resultPath}`);
}

async function main() {
  const action = process.argv[2] ?? "status";
  if (action === "status" || action === "--watch") {
    const seconds = Number(process.argv[3] ?? 120);
    if (!Number.isFinite(seconds) || seconds < 1) throw new Error("Watch interval must be positive seconds.");
    const tick = () => { const snapshot = status(); print(snapshot); return snapshot; };
    const first = tick();
    if (action === "status" || first.state !== "RUNNING") return;
    const timer = setInterval(() => { const snapshot = tick(); if (snapshot.state !== "RUNNING") clearInterval(timer); }, seconds * 1000);
    return;
  }
  if (action === "start") {
    const snapshot = status();
    if (snapshot.state === "COMPLETE") { print(snapshot); return; }
    if (snapshot.state !== "STOPPED") throw new Error(`Research process is already ${snapshot.state}.`);
    if (!snapshot.specHash || snapshot.proof !== "PASS" || !snapshot.diagnostic) throw new Error("Frozen spec, bounded proof and TRAIN breakdown diagnostic must exist before launch.");
    if (process.platform !== "darwin") throw new Error("This durable launcher uses macOS launchd; use the CLI directly on other systems.");
    mkdirSync(artifactRoot, { recursive: true });
    try { execFileSync("launchctl", ["remove", label], { stdio: "ignore" }); } catch { /* No prior one-shot job. */ }
    execFileSync("launchctl", ["submit", "-l", label, "-o", logPath, "-e", logPath, "--", process.execPath, script, "supervise"]);
    console.log(`Submitted Phase 8F.3 to launchd. Log: ${logPath}`);
    return;
  }
  if (action === "supervise") {
    const state = { pid: process.pid, state: "STARTING", startedAt: new Date().toISOString(), coordinatorPid: null, exitCode: null, error: null };
    atomic(supervisorPath, state);
    const child = spawn(process.execPath, ["--import", "tsx", coordinator, "run"], { cwd: path.join(root, "apps/api"), stdio: "inherit", env: { ...process.env, PATH: `${path.dirname(process.execPath)}:${process.env.PATH ?? "/usr/bin:/bin"}` } });
    state.coordinatorPid = child.pid;
    state.state = "RUNNING";
    atomic(supervisorPath, state);
    child.once("error", (error) => { state.state = "FAILED"; state.error = error.message; atomic(supervisorPath, state); process.exitCode = 1; });
    child.once("close", (code, signal) => {
      state.state = code === 0 ? "EXITED" : "FAILED";
      state.exitCode = code;
      if (code !== 0) state.error = `Coordinator exited: code=${code}, signal=${signal}`;
      atomic(supervisorPath, { ...state, exitedAt: new Date().toISOString() });
      process.exitCode = code === 0 ? 0 : 1;
    });
    return;
  }
  throw new Error("Usage: node scripts/controlled-optimization-process.mjs [start|status|--watch 120]");
}

if (process.argv[1] && path.resolve(process.argv[1]) === script) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
