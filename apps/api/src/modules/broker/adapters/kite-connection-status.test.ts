import { afterEach, describe, expect, it, vi } from "vitest";
import { KiteBrokerAdapter } from "./kite-broker-adapter";
import type { KiteSession } from "../types";

const originalFetch = globalThis.fetch;

afterEach(() => {
  vi.restoreAllMocks();
  globalThis.fetch = originalFetch;
});

function memoryTokenStore(initialSession: KiteSession | null = null) {
  let session = initialSession;
  return {
    save: vi.fn((next: KiteSession) => {
      session = next;
    }),
    load: vi.fn(() => session),
    hasSession: vi.fn(() => session !== null)
  };
}

function adapter(accessToken = "test-access-token", tokenStore = memoryTokenStore()) {
  return new KiteBrokerAdapter({
    apiKey: "test-api-key",
    apiSecret: "test-api-secret",
    accessToken,
    connectionVerificationTtlMs: 30_000,
    tokenStore: tokenStore as never
  });
}

function profileResponse() {
  return new Response(
    JSON.stringify({
      status: "success",
      data: {
        user_id: "AB1234",
        user_name: "Ada Trader",
        email: "ada@example.com",
        broker: "ZERODHA",
        exchanges: ["NSE"],
        products: ["MIS", "CNC"]
      }
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

describe("Kite connection status", () => {
  it("is NOT_CONFIGURED without a Kite API key", async () => {
    const status = await new KiteBrokerAdapter({
      apiKey: "",
      apiSecret: "secret",
      tokenStore: memoryTokenStore() as never
    }).getStatus();

    expect(status).toMatchObject({ status: "NOT_CONFIGURED", verified: false, brokerConnected: false });
  });

  it("is DISCONNECTED when no session exists", async () => {
    const status = await new KiteBrokerAdapter({
      apiKey: "key",
      apiSecret: "secret",
      tokenStore: memoryTokenStore() as never
    }).getStatus();

    expect(status).toMatchObject({ status: "DISCONNECTED", hasStoredSession: false, verified: false });
  });

  it("promotes a session to CONNECTED only after a successful profile read", async () => {
    globalThis.fetch = vi.fn(async () => profileResponse()) as typeof fetch;
    const status = await adapter().getStatus();

    expect(status).toMatchObject({ status: "CONNECTED", verified: true, brokerConnected: true, reasonCode: null });
    expect(status.lastVerifiedAt).toEqual(expect.any(String));
    expect(status.user).toMatchObject({ userId: "AB1234", userName: "Ada Trader" });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.kite.trade/user/profile",
      expect.objectContaining({ headers: expect.objectContaining({ "X-Kite-Version": "3" }) })
    );
  });

  it("reports an invalid stored session as AUTH_REQUIRED without exposing the token", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ status: "error", error_type: "TokenException", message: "Incorrect api_key or access_token." }), {
        status: 403,
        headers: { "content-type": "application/json" }
      })
    ) as typeof fetch;
    const status = await adapter("very-secret-token").getStatus();

    expect(status).toMatchObject({
      status: "AUTH_REQUIRED",
      hasStoredSession: true,
      verified: false,
      brokerConnected: false,
      reasonCode: "KITE_AUTH_EXPIRED"
    });
    expect(JSON.stringify(status)).not.toContain("very-secret-token");
  });

  it("reports verification transport failures as ERROR", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("network unavailable");
    }) as typeof fetch;

    await expect(adapter().getStatus()).resolves.toMatchObject({
      status: "ERROR",
      verified: false,
      reasonCode: "KITE_API_ERROR"
    });
  });

  it("uses the bounded successful-verification cache", async () => {
    globalThis.fetch = vi.fn(async () => profileResponse()) as typeof fetch;
    const kite = adapter();

    await kite.getStatus();
    await kite.getStatus();

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("transitions from CONNECTED to AUTH_REQUIRED after a later authenticated read is rejected", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(profileResponse())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "error", error_type: "TokenException", message: "expired" }), {
          status: 403,
          headers: { "content-type": "application/json" }
        })
      ) as typeof fetch;
    const kite = adapter();

    await expect(kite.getStatus()).resolves.toMatchObject({ status: "CONNECTED" });
    await expect(kite.getMargins()).rejects.toMatchObject({ code: "KITE_AUTH_EXPIRED" });

    expect(kite.getCachedStatus()).toMatchObject({ status: "AUTH_REQUIRED", verified: false });
  });

  it("stores an exchanged request-token session and verifies it before reporting success", async () => {
    const tokenStore = memoryTokenStore();
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: "success",
            data: {
              access_token: "fresh-access-token",
              user_id: "AB1234",
              user_name: "Ada Trader",
              email: "ada@example.com",
              broker: "ZERODHA",
              exchanges: ["NSE"],
              products: ["MIS", "CNC"]
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(profileResponse()) as typeof fetch;
    const kite = adapter("", tokenStore);

    await expect(kite.exchangeRequestToken("request-token")).resolves.toMatchObject({ userId: "AB1234" });
    expect(tokenStore.save).toHaveBeenCalledTimes(1);
    await expect(kite.getStatus()).resolves.toMatchObject({ status: "CONNECTED", verified: true });
  });

  it("does not report CONNECTED when request-token exchange fails", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ status: "error", error_type: "TokenException", message: "invalid request token" }), {
        status: 403,
        headers: { "content-type": "application/json" }
      })
    ) as typeof fetch;
    const kite = adapter("");

    await expect(kite.exchangeRequestToken("bad-request-token")).rejects.toMatchObject({ code: "KITE_AUTH_EXPIRED" });
    expect(kite.getCachedStatus()).not.toMatchObject({ status: "CONNECTED" });
  });
});
