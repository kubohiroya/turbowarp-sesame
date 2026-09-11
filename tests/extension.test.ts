import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SesameExtension } from "../src/extension.js";

const credentials = {
  API_KEY: "test-api-key",
  UUID: "00000000-0000-0000-0000-000000000000",
  SECRET_KEY: "00000000000000000000000000000000",
};

beforeEach(() => {
  vi.stubGlobal("Scratch", {
    extensions: { unsandboxed: true },
    BlockType: { COMMAND: "command", REPORTER: "reporter", BOOLEAN: "boolean" },
    ArgumentType: { STRING: "string", NUMBER: "number", BOOLEAN: "boolean" },
    Cast: {
      toString: (value: unknown) => String(value),
      toNumber: (value: unknown) => Number(value),
      toBoolean: (value: unknown) => Boolean(value),
    },
    translate: (message: string | { default: string }) =>
      typeof message === "string" ? message : message.default,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SesameExtension", () => {
  it("publishes the expected identity, blocks, menus, and icon", () => {
    const info = new SesameExtension().getInfo() as {
      id: string;
      name: string;
      docsURI: string;
      blockIconURI: string;
      blocks: Array<{ opcode: string }>;
      menus: Record<string, unknown>;
    };
    expect(info.id).toBe("kubohiroyasesame");
    expect(info.name).toBe("TurboWarp-Sesame");
    expect(info.docsURI).toBe("https://kubohiroya.github.io/turbowarp-sesame/");
    expect(info.blockIconURI).toMatch(/^data:image\/svg\+xml;base64,/u);
    expect(info.blocks.map((block) => block.opcode)).toContain(
      "getStatusField",
    );
    expect(info.blocks.map((block) => block.opcode)).toContain(
      "configureRelay",
    );
    expect(info.menus).toHaveProperty("statusFields");
  });

  it("keeps credentials only until they are cleared", () => {
    const extension = new SesameExtension();
    extension.configure(credentials);
    expect(extension.isConfigured()).toBe(true);
    extension.clearCredentials();
    expect(extension.isConfigured()).toBe(false);
  });

  it("reports invalid credentials instead of throwing", () => {
    const extension = new SesameExtension();
    expect(() =>
      extension.configure({ ...credentials, UUID: "invalid" }),
    ).not.toThrow();
    expect(extension.isConfigured()).toBe(false);
    expect(extension.lastError()).toContain("canonical UUID format");
  });

  it("configures and pairs with a local Relay without provider credentials", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            token: "a-valid-local-relay-token-value",
            expiresAt: Date.now() + 60_000,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { batteryPercentage: 87 } }), {
          status: 200,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const extension = new SesameExtension();

    extension.configureRelay({
      ENDPOINT: "http://127.0.0.1:8787",
      DEVICE_ALIAS: "front-door",
    });
    expect(extension.connectionMode()).toBe("relay");
    expect(extension.relayPaired()).toBe(false);
    expect(extension.isConfigured()).toBe(false);

    await extension.pairRelay({ CODE: "12345678" });
    expect(extension.relayPaired()).toBe(true);
    expect(extension.isConfigured()).toBe(true);
    await expect(
      extension.getStatusField({ FIELD: "batteryPercentage" }),
    ).resolves.toBe(87);

    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:8787/v1/pair");
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "http://127.0.0.1:8787/v1/candyhouse/devices/front-door/status",
    );
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("test-api-key");
  });

  it("rejects a non-loopback Relay endpoint", () => {
    const extension = new SesameExtension();
    extension.configureRelay({
      ENDPOINT: "https://relay.example.com",
      DEVICE_ALIAS: "front-door",
    });
    expect(extension.connectionMode()).toBe("not configured");
    expect(extension.lastError()).toContain("loopback hostname");
  });

  it("explains that Relay mode must run outside the TurboWarp sandbox", () => {
    vi.stubGlobal("Scratch", {
      ...Scratch,
      extensions: { unsandboxed: false },
    });
    const extension = new SesameExtension();

    extension.configureRelay({
      ENDPOINT: "http://127.0.0.1:8787",
      DEVICE_ALIAS: "front-door",
    });

    expect(extension.connectionMode()).toBe("not configured");
    expect(extension.lastError()).toContain("without sandbox");
  });

  it("fetches a selected status field", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ CHSesame2Status: "locked", batteryPercentage: 98 }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const extension = new SesameExtension();
    extension.configure(credentials);

    await expect(
      extension.getStatusField({ FIELD: "batteryPercentage" }),
    ).resolves.toBe(98);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://app.candyhouse.co/api/sesame2/00000000-0000-0000-0000-000000000000",
      expect.objectContaining({ headers: { "x-api-key": "test-api-key" } }),
    );
    expect(extension.lastError()).toBe("");
  });

  it("captures API errors and returns a safe fallback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: "denied" }), { status: 403 }),
      ),
    );
    const extension = new SesameExtension();
    extension.configure(credentials);

    await expect(
      extension.getStatusField({ FIELD: "CHSesame2Status" }),
    ).resolves.toBe("");
    expect(extension.lastError()).toBe(
      "Candy House API request failed (403): denied",
    );
  });

  it("never sends a lock request while the feature flag is off", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const extension = new SesameExtension();
    extension.configure(credentials);

    expect(extension.commandsEnabled()).toBe(false);
    await expect(
      extension.sendCommand({ COMMAND: "unlock", HISTORY: "test" }),
    ).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(extension.lastError()).toBe(
      "Remote lock commands are disabled in this build.",
    );
  });
});
