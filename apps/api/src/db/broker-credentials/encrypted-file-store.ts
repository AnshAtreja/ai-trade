import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { BrokerCredentialStore, BrokerCredentials } from "./types";

const credentialsDir = path.resolve(process.cwd(), ".secure", "credentials");

/**
 * Encrypted-file credential store. This is the abstraction that must be used
 * instead of Prisma columns for Kite access tokens. AES-256-GCM encryption is
 * a development-grade control; replace with a secrets manager before production.
 */
export class EncryptedFileBrokerCredentialStore implements BrokerCredentialStore {
  constructor(private readonly encryptionSecret: string) {}

  async save(ref: string, credentials: BrokerCredentials) {
    this.ensureSecret();
    mkdirSync(credentialsDir, { recursive: true, mode: 0o700 });

    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.getKey(), iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(credentials), "utf8"), cipher.final()]);
    const payload = {
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: encrypted.toString("base64")
    };

    writeFileSync(this.filePath(ref), JSON.stringify(payload), { mode: 0o600 });
  }

  async load(ref: string): Promise<BrokerCredentials | null> {
    this.ensureSecret();

    const filePath = this.filePath(ref);

    if (!existsSync(filePath)) {
      return null;
    }

    const payload = JSON.parse(readFileSync(filePath, "utf8")) as { iv: string; tag: string; data: string };
    const decipher = createDecipheriv("aes-256-gcm", this.getKey(), Buffer.from(payload.iv, "base64"));

    decipher.setAuthTag(Buffer.from(payload.tag, "base64"));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(payload.data, "base64")),
      decipher.final()
    ]);

    return JSON.parse(decrypted.toString("utf8")) as BrokerCredentials;
  }

  async delete(ref: string) {
    const filePath = this.filePath(ref);

    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  }

  private filePath(ref: string) {
    const safeRef = ref.replace(/[^a-zA-Z0-9._-]/g, "_");

    return path.join(credentialsDir, `${safeRef}.enc`);
  }

  private getKey() {
    return createHash("sha256").update(this.encryptionSecret).digest();
  }

  private ensureSecret() {
    if (!this.encryptionSecret) {
      throw new Error("An encryption secret is required to store broker credentials. Do not write access tokens to the database.");
    }
  }
}
