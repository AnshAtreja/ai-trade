/**
 * Kite-specific encrypted file store.
 * persistent: no database columns for access tokens
 * mock: unused
 * broker integration: encrypts the Kite session for market-data auth
 * paper trading: n/a
 * live trading disabled: stored tokens must not be used to place live orders
 *
 * Prefer BrokerCredentialStore for new credential types. Never store plaintext
 * Kite access tokens in PostgreSQL.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { KiteSession } from "../types";

const tokenFilePath = path.resolve(process.cwd(), ".secure", "kite-session.enc");

export class KiteTokenStore {
  constructor(private readonly encryptionSecret: string) {}

  save(session: KiteSession) {
    this.ensureSecret();
    mkdirSync(path.dirname(tokenFilePath), { recursive: true, mode: 0o700 });

    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.getKey(), iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(session), "utf8"), cipher.final()]);
    const payload = {
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: encrypted.toString("base64")
    };

    writeFileSync(tokenFilePath, JSON.stringify(payload), { mode: 0o600 });
  }

  load(): KiteSession | null {
    this.ensureSecret();

    if (!existsSync(tokenFilePath)) {
      return null;
    }

    const payload = JSON.parse(readFileSync(tokenFilePath, "utf8")) as { iv: string; tag: string; data: string };
    const decipher = createDecipheriv("aes-256-gcm", this.getKey(), Buffer.from(payload.iv, "base64"));

    decipher.setAuthTag(Buffer.from(payload.tag, "base64"));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(payload.data, "base64")),
      decipher.final()
    ]);

    return JSON.parse(decrypted.toString("utf8")) as KiteSession;
  }

  hasSession() {
    return existsSync(tokenFilePath);
  }

  private getKey() {
    return createHash("sha256").update(this.encryptionSecret).digest();
  }

  private ensureSecret() {
    if (!this.encryptionSecret) {
      throw new Error("KITE_API_SECRET is required to securely store Kite access tokens.");
    }
  }
}
