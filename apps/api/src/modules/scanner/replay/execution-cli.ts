import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { HistoricalReplayRunner } from "./historical-replay-runner";
import { executeHistoricalPaperReplay } from "./historical-paper-execution";

async function main() {
  const tokens = values("--token").concat(values("--tokens").flatMap((value) => value.split(","))).filter(Boolean);
  if (!tokens.length) throw new Error("Missing --token.");
  const from = required("--from");
  const to = required("--to");
  const startingCapital = Number(value("--starting-capital") ?? "100000");
  if (!(startingCapital > 0)) throw new Error("--starting-capital must be positive.");
  const replay = await new HistoricalReplayRunner().run({ tokens: [...new Set(tokens)], from, to, interval: (value("--interval") ?? "1m") as "1m" | "5m" });
  const result = executeHistoricalPaperReplay(replay, { startingCapital });
  const output = value("--output");
  if (output) { const outputPath = path.resolve(process.cwd(), output); mkdirSync(path.dirname(outputPath), { recursive: true }); writeFileSync(outputPath, JSON.stringify(result, null, 2)); }
  console.log(JSON.stringify({ summary: result.summary, runId: result.runId, limitations: result.limitations, output: output ? path.resolve(process.cwd(), output) : null }, null, 2));
}
function values(name: string) { const out: string[] = []; for (let i = 0; i < process.argv.length; i += 1) if (process.argv[i] === name && process.argv[i + 1]) out.push(process.argv[i + 1]!); return out; }
function value(name: string) { return values(name)[0] ?? null; }
function required(name: string) { const result = value(name); if (!result) throw new Error(`Missing ${name}.`); return result; }
void main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
