import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { atomicResearchJson } from "./robustness-durability";

export class RobustnessRuntime {
  private readonly workers = new Map<number, Record<string, unknown>>();
  private readonly startedAt = new Date().toISOString();
  private state = "RUNNING";
  private lastError: string | null = null;
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly lock: string;
  constructor(private readonly file: string, private readonly specHash: string, private readonly baselineRunId: string, private readonly phase: "8F2" | "8F3" = "8F2") {
    this.lock = `${file}.lock`;
    if (existsSync(this.lock)) {
      const existing = JSON.parse(readFileSync(this.lock, "utf8"));
      let alive = true;
      try { process.kill(existing.pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") alive = false; else throw error; }
      if (alive) throw new Error(`Research coordinator lock is held by PID ${existing.pid}.`);
      unlinkSync(this.lock);
    }
    writeFileSync(this.lock, JSON.stringify({ pid: process.pid, startedAt: this.startedAt }), { flag: "wx", mode: 0o600 });
    this.save();
    this.timer = setInterval(() => this.save(), 15_000);
    this.timer.unref();
  }

  runChild(script: string, requestPath: string, identity: Record<string, unknown>, cwd: string) {
    return new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", script, "--request", requestPath], { cwd, stdio: ["ignore", "pipe", "pipe"], env: process.env });
      const pid = child.pid;
      if (!pid) { child.once("error", reject); return; }
      const worker: Record<string, unknown> = { ...identity, pid, requestPath, script: path.resolve(cwd, script), state: "RUNNING", startedAt: new Date().toISOString() };
      this.workers.set(pid, worker);
      this.save();
      const lines = createInterface({ input: child.stdout! });
      lines.on("line", (line) => {
        try {
          const event = JSON.parse(line);
          if (event.type === "phase8f2_heartbeat" || event.type === "phase8f2_cost_heartbeat" || event.type === "phase8f3_heartbeat") {
            worker.lastHeartbeatAt = new Date().toISOString();
            worker.progress = event;
            this.save();
          }
        } catch { /* Non-JSON worker output remains in the durable log. */ }
        process.stdout.write(`${line}\n`);
      });
      child.stderr!.on("data", (chunk: Buffer) => {
        worker.lastStderr = (String(worker.lastStderr ?? "") + chunk.toString()).slice(-4000);
        process.stderr.write(chunk);
        this.save();
      });
      child.once("error", (error) => { worker.state = "FAILED"; worker.error = error.message; this.save(); reject(error); });
      child.once("close", (code, signal) => {
        worker.state = code === 0 ? "EXITED" : "FAILED";
        worker.exitCode = code;
        worker.signal = signal;
        worker.exitedAt = new Date().toISOString();
        this.save();
        process.stdout.write(JSON.stringify({ type: "phase8f2_worker_exit", ...identity, pid, code, signal }) + "\n");
        if (code === 0) resolve(); else reject(new Error(`Research worker ${pid} exited with code=${code}, signal=${signal}: ${JSON.stringify(identity)}`));
      });
    });
  }

  finish(error?: unknown) {
    clearInterval(this.timer);
    this.state = error ? "FAILED" : "COMPLETE";
    this.lastError = error ? String(error) : null;
    this.save();
    if (existsSync(this.lock) && JSON.parse(readFileSync(this.lock, "utf8")).pid === process.pid) unlinkSync(this.lock);
  }

  private save() {
    atomicResearchJson(this.file, { format: `${this.phase}-RUNTIME-1`, specHash: this.specHash, baselineRunId: this.baselineRunId, coordinatorPid: process.pid, startedAt: this.startedAt, updatedAt: new Date().toISOString(), state: this.state, lastError: this.lastError, workers: [...this.workers.values()] });
  }
}
