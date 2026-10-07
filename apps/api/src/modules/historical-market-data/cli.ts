import { getHistoricalMarketDataService } from "./service";

/**
 * CLI: inspect historical coverage / trigger a mock-friendly download.
 *
 * Examples:
 *   npm run historical:coverage --workspace api
 *   npm run historical:coverage --workspace api -- --token 2885 --interval 1m
 *   npm run historical:download --workspace api -- --token 2885 --from 2026-09-10T03:45:00.000Z --to 2026-09-10T10:00:00.000Z
 */
async function main() {
  const cmd = process.argv[2] ?? "coverage";
  const service = getHistoricalMarketDataService();

  if (cmd === "coverage") {
    const token = getArg("--token");
    const interval = getArg("--interval") as "1m" | "5m" | null;
    const coverage = await service.coverage({
      instrumentToken: token ?? undefined,
      interval: interval === "1m" || interval === "5m" ? interval : undefined,
      from: getArg("--from") ?? undefined,
      to: getArg("--to") ?? undefined
    });
    console.log(JSON.stringify({ coverage, rangeSemantics: "[from, to)" }, null, 2));
    return;
  }

  if (cmd === "download") {
    const token = getArg("--token");
    const from = getArg("--from");
    const to = getArg("--to");
    if (!token || !from || !to) {
      throw new Error("download requires --token --from --to");
    }
    const result = await service.download({
      instrumentToken: token,
      tradingSymbol: getArg("--symbol") ?? undefined,
      exchange: getArg("--exchange") ?? "NSE",
      from,
      to,
      reconcile: process.argv.includes("--reconcile")
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (cmd === "validate") {
    const token = getArg("--token");
    const from = getArg("--from");
    const to = getArg("--to");
    if (!token || !from || !to) {
      throw new Error("validate requires --token --from --to");
    }
    const report = await service.validate({
      instrumentToken: token,
      interval: (getArg("--interval") as "1m" | "5m" | null) ?? "1m",
      from,
      to
    });
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (cmd === "dataset-validate" || cmd === "bulk-download") {
    const tokens = getAllArgs("--token").concat((getAllArgs("--tokens")).flatMap(value => value.split(",")).filter(Boolean));
    const from = getArg("--from"); const to = getArg("--to");
    if (!tokens.length || !from || !to) throw new Error(`${cmd} requires --token(s) --from --to`);
    const input = { tokens: [...new Set(tokens)], from, to, interval: (getArg("--interval") as "1m" | "5m" | null) ?? "1m" };
    console.log(JSON.stringify(cmd === "bulk-download" ? await service.bulkDownload(input) : await service.validateDataset(input), null, 2));
    return;
  }

  throw new Error(`Unknown command ${cmd}. Use coverage | download | validate | dataset-validate | bulk-download`);
}
function getAllArgs(name: string) { const values: string[] = []; for (let index = 0; index < process.argv.length; index += 1) if (process.argv[index] === name && process.argv[index + 1]) values.push(process.argv[index + 1]!); return values; }

function getArg(name: string) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
