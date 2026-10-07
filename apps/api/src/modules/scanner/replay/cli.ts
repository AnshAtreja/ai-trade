import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { HistoricalReplayRunner } from "./historical-replay-runner";

async function main() {
  const tokens = getTokens();
  const from = requireArg("--from");
  const to = requireArg("--to");
  const interval = (getArgValue("--interval") ?? "1m") as "1m" | "5m";
  const strategyIds = getArgValue("--strategies")
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const runner = new HistoricalReplayRunner();
  const result = await runner.run({
    tokens,
    from,
    to,
    interval,
    strategyIds
  });

  const output = getArgValue("--output");
  if (output) {
    const outputPath = path.resolve(process.cwd(), output);
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, JSON.stringify(result, null, 2));
  }

  console.log(
    JSON.stringify(
      {
        summary: result.summary,
        validationIssues: result.validationIssues,
        limitations: result.limitations,
        output: output ? path.resolve(process.cwd(), output) : null
      },
      null,
      2
    )
  );
}

function getTokens() {
  const tokenValues = [
    ...getAllArgValues("--token"),
    ...getAllArgValues("--tokens").flatMap((value) => value.split(","))
  ]
    .map((value) => value.trim())
    .filter(Boolean);

  if (tokenValues.length === 0) {
    throw new Error(
      "Missing --token. Example: npm run backtest:replay --workspace api -- --token 738561 --from 2026-09-15T03:45:00.000Z --to 2026-09-15T10:00:00.000Z --interval 1m"
    );
  }

  return [...new Set(tokenValues)];
}

function requireArg(name: string) {
  const value = getArgValue(name);
  if (!value) {
    throw new Error(`Missing ${name}.`);
  }
  return value;
}

function getArgValue(name: string) {
  return getAllArgValues(name)[0] ?? null;
}

function getAllArgValues(name: string) {
  const values: string[] = [];
  for (let i = 0; i < process.argv.length; i += 1) {
    if (process.argv[i] === name && process.argv[i + 1]) {
      values.push(process.argv[i + 1]!);
    }
  }
  return values;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
