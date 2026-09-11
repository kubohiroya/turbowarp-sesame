import { describe, expect, it, vi } from "vitest";
import {
  pairWithRelay,
  RelayClient,
  validateRelayConfiguration,
} from "../src/relay-client.js";

const configuration = {
  endpoint: "http://127.0.0.1:8787",
  deviceAlias: "front-door",
};

const session = {
  ...configuration,
  token: "a-valid-local-relay-token-value",
  expiresAt: Date.now() + 60_000,
};

describe("local Relay client", () => {
  it("accepts only loopback HTTP origins", () => {
    expect(validateRelayConfiguration(configuration)).toEqual(configuration);
    expect(() =>
      validateRelayConfiguration({
        endpoint: "https://relay.example.com",
        deviceAlias: "front-door",
      }),
    ).toThrow(/loopback/iu);
    expect(() =>
      validateRelayConfiguration({
        endpoint: "http://127.0.0.1:8787/unexpected",
        deviceAlias: "front-door",
      }),
    ).toThrow(/origin/iu);
  });

  it("exchanges a one-time code for a memory-only session", async () => {
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return new Response(
          JSON.stringify({
            token: session.token,
            expiresAt: session.expiresAt,
          }),
          { status: 200 },
        );
      },
    );

    await expect(
      pairWithRelay(configuration, "12345678", fetcher),
    ).resolves.toEqual(session);
    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/v1/pair",
      expect.objectContaining({
        method: "POST",
        body: '{"code":"12345678"}',
        redirect: "error",
      }),
    );
  });

  it("uses the paired token and device alias for named capabilities", async () => {
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return new Response('{"data":{"batteryPercentage":95}}', {
          status: 200,
        });
      },
    );
    const client = new RelayClient(session, fetcher);

    await expect(client.getStatus()).resolves.toEqual({
      batteryPercentage: 95,
    });
    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/v1/candyhouse/devices/front-door/status",
      expect.objectContaining({
        headers: { authorization: `Bearer ${session.token}` },
        redirect: "error",
      }),
    );
  });

  it("reports public Relay errors without including the session token", async () => {
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return new Response(
          '{"error":{"code":"capability_denied","message":"Commands are disabled."}}',
          { status: 403 },
        );
      },
    );
    const client = new RelayClient(session, fetcher);

    const error = await client.getStatus().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain("Commands are disabled.");
    expect(String(error)).not.toContain(session.token);
  });

  it("does not send an expired Relay session", async () => {
    const fetcher = vi.fn();
    const client = new RelayClient(
      { ...session, expiresAt: Date.now() - 1 },
      fetcher,
    );

    await expect(client.getStatus()).rejects.toThrow(/expired/iu);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
