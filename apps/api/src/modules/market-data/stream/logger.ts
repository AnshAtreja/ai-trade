import { DEMO_USER_EMAIL, DEMO_USER_NAME } from "../../../db/domain";
import { getRepositories } from "../../../db/persistence";
import type { AppRepositories } from "../../../db/repositories/contracts";

const SOURCE = "market-stream";

export class StreamLogger {
  private lastParseLogAt = 0;

  constructor(private readonly resolveRepos: () => AppRepositories = getRepositories) {}

  info(event: string, message: string, metadata: Record<string, unknown> = {}) {
    this.write("INFO", event, message, metadata);
  }

  warn(event: string, message: string, metadata: Record<string, unknown> = {}) {
    this.write("WARN", event, message, metadata);
  }

  error(event: string, message: string, metadata: Record<string, unknown> = {}) {
    this.write("ERROR", event, message, metadata);
  }

  parseError(message: string, metadata: Record<string, unknown> = {}) {
    const now = Date.now();
    if (now - this.lastParseLogAt < 1000) {
      return;
    }
    this.lastParseLogAt = now;
    this.error("market_stream_parse_error", message, metadata);
  }

  private write(level: "INFO" | "WARN" | "ERROR", event: string, message: string, metadata: Record<string, unknown>) {
    void this.resolveRepos()
      .users.upsertByEmail({ email: DEMO_USER_EMAIL, name: DEMO_USER_NAME })
      .then((user) =>
        this.resolveRepos().systemLogs.create({
          userId: user.id,
          level,
          source: SOURCE,
          message,
          metadata: { event, ...metadata }
        })
      )
      .catch(() => undefined);
  }
}
