import { describe, expect, it } from "vitest";
import {
  encodeHistoryTag,
  MAX_HISTORY_TAG_BYTES,
  SesameBleTransport,
} from "../src/ble/ble-transport.js";
import { ItemCode, OpCode } from "../src/ble/protocol.js";
import type { SesameTransport } from "../src/transport.js";
import { FakeKeyholder, FakeSesame } from "./helpers/fake-sesame.js";

const un = (value: string): Uint8Array =>
  Uint8Array.from(Buffer.from(value, "hex"));

const SECRET = un("2b7e151628aed2a6abf7158809cf4f3c");
const RANDOM_CODE = un("deadbeef");

/** Battery 2890, target and position zero, flags in the low byte. */
const statusPayload = (flags: number): Uint8Array =>
  Uint8Array.from([0x4a, 0x0b, 0, 0, 0, 0, flags]);

const LOCKED = statusPayload(0b0000_0010);
const UNLOCKED = statusPayload(0b0000_0100);

/** Resolves with the next status the transport reports. */
const nextStatus = (transport: SesameBleTransport): Promise<unknown> =>
  new Promise((resolve) => {
    const off = transport.onStatusChange((status) => {
      off();
      resolve(status);
    });
  });

const build = (options: { secret?: Uint8Array; timeouts?: object } = {}) => {
  const device = new FakeSesame(SECRET, RANDOM_CODE);
  const transport = new SesameBleTransport({
    channel: device,
    keyholder: new FakeKeyholder(options.secret ?? SECRET),
    deviceName: "front-door",
    timeouts: { randomCode: 200, login: 200, command: 200, status: 200 },
    ...options.timeouts,
  });
  return { device, transport };
};

describe("connecting", () => {
  it("logs in with a proof the device accepts", async () => {
    const { device, transport } = build();
    await transport.connect();
    expect(transport.isLoggedIn()).toBe(true);
    expect(device.loggedIn).toBe(true);
    expect(device.requests[0]?.itemCode).toBe(ItemCode.login);
    expect(device.requests[0]?.payload).toHaveLength(4);
  });

  it("fails when the keyholder holds the wrong secret", async () => {
    const { device, transport } = build({ secret: un("00".repeat(16)) });
    await expect(transport.connect()).rejects.toThrow(/refused to log in/u);
    expect(transport.isLoggedIn()).toBe(false);
    expect(device.closed).toBe(true);
  });

  it("times out when the device never starts a session", async () => {
    const device = new FakeSesame(SECRET, RANDOM_CODE);
    device.subscribe = () => () => undefined; // never publishes
    const transport = new SesameBleTransport({
      channel: device,
      keyholder: new FakeKeyholder(SECRET),
      deviceName: "front-door",
      timeouts: { randomCode: 50, login: 50, command: 50, status: 50 },
    });
    await expect(transport.connect()).rejects.toThrow(
      /did not start a session/u,
    );
  });

  it("is idempotent once connected", async () => {
    const { device, transport } = build();
    await transport.connect();
    await transport.connect();
    expect(
      device.requests.filter((r) => r.itemCode === ItemCode.login),
    ).toHaveLength(1);
  });

  it("refuses to reconnect after closing", async () => {
    const { transport } = build();
    await transport.connect();
    await transport.close();
    await expect(transport.connect()).rejects.toThrow(/closed/u);
  });

  it("closes the channel when login fails, leaving nothing half-open", async () => {
    const { device, transport } = build({ secret: un("00".repeat(16)) });
    await expect(transport.connect()).rejects.toThrow();
    expect(device.closed).toBe(true);
    await expect(transport.getStatus()).rejects.toThrow(
      /Connect to the Sesame first/u,
    );
  });
});

describe("status", () => {
  it("reports state the device pushed, in Web API field names", async () => {
    const { device, transport } = build();
    await transport.connect();
    const arrived = nextStatus(transport);
    await device.publishStatus(LOCKED);
    await arrived;
    const status = await transport.getStatus();
    expect(status.CHSesame2Status).toBe("locked");
    expect(status.batteryVoltage).toBeCloseTo(5.78, 5);
  });

  it("asks for status when none has been pushed yet", async () => {
    const { device, transport } = build();
    device.onRequest = (request) =>
      request.itemCode === ItemCode.mechStatus
        ? [Uint8Array.from([OpCode.publish, 81, ...LOCKED])]
        : [Uint8Array.from([OpCode.response, request.itemCode, 0x00])];
    await transport.connect();
    expect((await transport.getStatus()).CHSesame2Status).toBe("locked");
  });

  it("times out when the device neither answers nor pushes", async () => {
    const { device, transport } = build();
    await transport.connect();
    device.onRequest = () => [];
    await expect(transport.getStatus()).rejects.toThrow(
      /did not report its state/u,
    );
  });

  it("notifies listeners on every push and stops after unsubscribing", async () => {
    const { device, transport } = build();
    await transport.connect();
    const seen: unknown[] = [];
    const unsubscribe = transport.onStatusChange((status) => {
      seen.push(status.CHSesame2Status);
    });

    let arrived = nextStatus(transport);
    await device.publishStatus(LOCKED);
    await arrived;
    arrived = nextStatus(transport);
    await device.publishStatus(UNLOCKED);
    await arrived;

    unsubscribe();
    await device.publishStatus(LOCKED);
    // Frames are decoded in arrival order, so a later round trip proves the
    // status above was handled before this assertion runs.
    await transport.sendCommand("lock", "t");
    expect(seen).toEqual(["locked", "unlocked"]);
  });

  it("keeps working when a listener throws", async () => {
    const { device, transport } = build();
    await transport.connect();
    const seen: unknown[] = [];
    transport.onStatusChange(() => {
      throw new Error("listener is broken");
    });
    transport.onStatusChange((status) => {
      seen.push(status.CHSesame2Status);
    });
    const arrived = nextStatus(transport);
    await device.publishStatus(LOCKED);
    await arrived;
    expect(seen).toEqual(["locked"]);
  });

  it("refuses before connecting", async () => {
    const { transport } = build();
    await expect(transport.getStatus()).rejects.toThrow(
      /Connect to the Sesame first/u,
    );
  });
});

describe("commands", () => {
  it("sends lock as item code 82 with a length-prefixed tag", async () => {
    const { device, transport } = build();
    await transport.connect();
    await transport.sendCommand("lock", "scratch");
    const request = device.requests.find((r) => r.itemCode === ItemCode.lock);
    expect(request).toBeDefined();
    expect(Array.from(request?.payload ?? [])).toEqual([
      7,
      ...Buffer.from("scratch", "utf8"),
    ]);
  });

  it("sends unlock as item code 83", async () => {
    const { device, transport } = build();
    await transport.connect();
    await transport.sendCommand("unlock", "");
    expect(device.requests.some((r) => r.itemCode === ItemCode.unlock)).toBe(
      true,
    );
  });

  it("resolves toggle from the reported state, since BLE has no toggle", async () => {
    const { device, transport } = build();
    await transport.connect();

    let arrived = nextStatus(transport);
    await device.publishStatus(LOCKED);
    await arrived;
    await transport.sendCommand("toggle", "t");
    expect(device.requests.some((r) => r.itemCode === ItemCode.unlock)).toBe(
      true,
    );

    arrived = nextStatus(transport);
    await device.publishStatus(UNLOCKED);
    await arrived;
    await transport.sendCommand("toggle", "t");
    expect(device.requests.some((r) => r.itemCode === ItemCode.lock)).toBe(
      true,
    );
  });

  it("surfaces a refusal from the device", async () => {
    const { device, transport } = build();
    await transport.connect();
    device.onRequest = (request) => [
      Uint8Array.from([OpCode.response, request.itemCode, 0x09]),
    ];
    await expect(transport.sendCommand("lock", "t")).rejects.toThrow(
      /refused to lock the Sesame \(result 9\)/u,
    );
  });

  it("times out when the device stays silent", async () => {
    const { device, transport } = build();
    await transport.connect();
    device.onRequest = () => [];
    await expect(transport.sendCommand("lock", "t")).rejects.toThrow(
      /did not answer the lock request/u,
    );
  });

  it("keeps counters in step across a run of commands", async () => {
    const { device, transport } = build();
    await transport.connect();
    for (let index = 0; index < 8; index += 1) {
      await transport.sendCommand(
        index % 2 === 0 ? "lock" : "unlock",
        `run${index}`,
      );
    }
    expect(
      device.requests.filter((r) => r.itemCode !== ItemCode.login),
    ).toHaveLength(8);
  });

  it("stays usable after a command that timed out", async () => {
    const { device, transport } = build();
    await transport.connect();
    const answer = device.onRequest;
    device.onRequest = () => [];
    await expect(transport.sendCommand("lock", "t")).rejects.toThrow();
    device.onRequest = answer;
    // The device advanced its receive counter for the dropped request, so the
    // session is still aligned and the next command must go through.
    await expect(transport.sendCommand("unlock", "t")).resolves.toBeDefined();
  });

  it("omits history as a capability", () => {
    // Typed through the interface, because the concrete class does not declare
    // `getHistory` at all — its absence is a compile-time fact, not only a
    // runtime one.
    const transport: SesameTransport = build().transport;
    expect(transport.capabilities().has("history")).toBe(false);
    expect(transport.capabilities().has("statusEvents")).toBe(true);
    expect(transport.getHistory).toBeUndefined();
  });
});

describe("closing", () => {
  it("closes the channel and refuses further work", async () => {
    const { device, transport } = build();
    await transport.connect();
    await transport.close();
    expect(device.closed).toBe(true);
    expect(transport.isLoggedIn()).toBe(false);
    await expect(transport.sendCommand("lock", "t")).rejects.toThrow(
      /Connect to the Sesame first/u,
    );
  });

  it("is safe to close twice and before connecting", async () => {
    const { transport } = build();
    await expect(transport.close()).resolves.toBeUndefined();
    await expect(transport.close()).resolves.toBeUndefined();
  });

  it("fails anything still waiting", async () => {
    const { device, transport } = build();
    await transport.connect();
    device.onRequest = () => [];
    const pending = transport.sendCommand("lock", "t");
    await transport.close();
    await expect(pending).rejects.toThrow(/connection closed/u);
  });
});

describe("history tag encoding", () => {
  it("prefixes the byte length", () => {
    expect(Array.from(encodeHistoryTag("ab"))).toEqual([2, 0x61, 0x62]);
  });

  it("encodes an empty tag as a single zero", () => {
    expect(Array.from(encodeHistoryTag(""))).toEqual([0]);
  });

  it("truncates to the limit the lock accepts", () => {
    const encoded = encodeHistoryTag("x".repeat(100));
    expect(encoded[0]).toBe(MAX_HISTORY_TAG_BYTES);
    expect(encoded).toHaveLength(MAX_HISTORY_TAG_BYTES + 1);
  });

  it("drops a multi-byte character whole rather than splitting it", () => {
    // Ten three-byte characters is thirty bytes, one over the limit.
    const encoded = encodeHistoryTag("あ".repeat(10));
    expect(encoded[0]).toBe(27);
    expect(new TextDecoder().decode(encoded.subarray(1))).toBe("あ".repeat(9));
  });
});
