import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isWebBluetoothAvailable,
  requestSesameChannel,
} from "../src/ble/web-bluetooth.js";
import {
  RX_CHARACTERISTIC_UUID,
  SERVICE_UUID,
  TX_CHARACTERISTIC_UUID,
} from "../src/ble/protocol.js";

/** A Web Bluetooth stack reduced to what the channel touches. */
const fakeBluetooth = (deviceName = "front door") => {
  const written: Uint8Array[] = [];
  const listeners = new Map<string, (event: Event) => void>();
  let notifying = false;
  let connected = true;
  const requested: unknown[] = [];

  const characteristic = (uuid: string) => ({
    uuid,
    value: undefined as DataView | undefined,
    writeValueWithoutResponse: (value: BufferSource) => {
      written.push(new Uint8Array(value as ArrayBuffer));
      return Promise.resolve();
    },
    startNotifications() {
      notifying = true;
      return Promise.resolve(this);
    },
    stopNotifications() {
      notifying = false;
      return Promise.resolve(this);
    },
    addEventListener: (type: string, listener: (event: Event) => void) => {
      listeners.set(type, listener);
    },
    removeEventListener: (type: string) => {
      listeners.delete(type);
    },
  });

  const rx = characteristic(RX_CHARACTERISTIC_UUID);
  const tx = characteristic(TX_CHARACTERISTIC_UUID);

  const server = {
    get connected() {
      return connected;
    },
    connect() {
      return Promise.resolve(server);
    },
    disconnect() {
      connected = false;
    },
    getPrimaryService: (uuid: string | number) =>
      uuid === SERVICE_UUID
        ? Promise.resolve({
            getCharacteristic: (id: string) =>
              Promise.resolve(id === TX_CHARACTERISTIC_UUID ? tx : rx),
          })
        : Promise.reject(new Error("no such service")),
  };

  const bluetooth = {
    requestDevice: (options: unknown) => {
      requested.push(options);
      return Promise.resolve({ name: deviceName, gatt: server });
    },
  };

  /** Delivers a notification the way the browser does. */
  const notify = (packet: Uint8Array) => {
    rx.value = new DataView(packet.buffer.slice(0));
    listeners.get("characteristicvaluechanged")?.({
      target: rx,
    } as unknown as Event);
  };

  return {
    bluetooth,
    written,
    requested,
    notify,
    isNotifying: () => notifying,
    isConnected: () => connected,
    hasListener: () => listeners.has("characteristicvaluechanged"),
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("availability", () => {
  it("reports absence rather than throwing", () => {
    vi.stubGlobal("navigator", {});
    expect(isWebBluetoothAvailable()).toBe(false);
  });

  it("requires an actual requestDevice, not just the property", () => {
    vi.stubGlobal("navigator", { bluetooth: {} });
    expect(isWebBluetoothAvailable()).toBe(false);
  });

  it("explains what to use instead when unavailable", async () => {
    vi.stubGlobal("navigator", {});
    await expect(requestSesameChannel()).rejects.toThrow(/Relay mode/u);
  });
});

describe("the channel", () => {
  const open = async () => {
    const stack = fakeBluetooth();
    vi.stubGlobal("navigator", { bluetooth: stack.bluetooth });
    return { stack, channel: await requestSesameChannel() };
  };

  it("filters the chooser to the Sesame service", async () => {
    const { stack } = await open();
    expect(stack.requested[0]).toEqual({
      filters: [{ services: [SERVICE_UUID] }],
      optionalServices: [SERVICE_UUID],
    });
  });

  it("enables notifications before returning", async () => {
    const { stack } = await open();
    expect(stack.isNotifying()).toBe(true);
  });

  it("writes packets to the Tx characteristic", async () => {
    const { stack, channel } = await open();
    await channel.write(Uint8Array.from([1, 2, 3]));
    expect(Array.from(stack.written[0] ?? [])).toEqual([1, 2, 3]);
  });

  it("copies the packet, since the browser may keep the view", async () => {
    const { stack, channel } = await open();
    const packet = Uint8Array.from([1, 2, 3]);
    await channel.write(packet);
    packet[0] = 0xff;
    expect(stack.written[0]?.[0]).toBe(1);
  });

  it("delivers notifications to every subscriber", async () => {
    const { stack, channel } = await open();
    const first: number[][] = [];
    const second: number[][] = [];
    channel.subscribe((packet) => first.push(Array.from(packet)));
    const off = channel.subscribe((packet) => second.push(Array.from(packet)));
    stack.notify(Uint8Array.from([0x03, 0xaa]));
    off();
    stack.notify(Uint8Array.from([0x03, 0xbb]));
    expect(first).toEqual([
      [0x03, 0xaa],
      [0x03, 0xbb],
    ]);
    expect(second).toEqual([[0x03, 0xaa]]);
  });

  it("stops notifying, unhooks, and disconnects on close", async () => {
    const { stack, channel } = await open();
    await channel.close();
    expect(stack.isNotifying()).toBe(false);
    expect(stack.hasListener()).toBe(false);
    expect(stack.isConnected()).toBe(false);
  });

  it("refuses to write once closed", async () => {
    const { channel } = await open();
    await channel.close();
    await expect(channel.write(Uint8Array.from([1]))).rejects.toThrow(
      /closed/u,
    );
  });

  it("is safe to close twice", async () => {
    const { channel } = await open();
    await channel.close();
    await expect(channel.close()).resolves.toBeUndefined();
  });

  it("rejects a device with no GATT server", async () => {
    vi.stubGlobal("navigator", {
      bluetooth: { requestDevice: () => Promise.resolve({ name: "x" }) },
    });
    await expect(requestSesameChannel()).rejects.toThrow(/no GATT server/u);
  });
});

describe("notifications that arrive before anyone is listening", () => {
  /**
   * A Sesame publishes its session random code as soon as notifications are
   * enabled, which is before the transport has subscribed. That publish
   * happens once per connection: dropping it means the session can never
   * start, which on real hardware looked like the lock ignoring us.
   */
  const open = async () => {
    const stack = fakeBluetooth();
    vi.stubGlobal("navigator", { bluetooth: stack.bluetooth });
    return { stack, channel: await requestSesameChannel() };
  };

  it("keeps a packet that arrives before the first subscriber", async () => {
    const { stack, channel } = await open();
    stack.notify(Uint8Array.from([0x03, 0x08, 0x0e, 0xde, 0xad, 0xbe, 0xef]));

    const seen: number[][] = [];
    channel.subscribe((packet) => seen.push(Array.from(packet)));
    expect(seen).toEqual([[0x03, 0x08, 0x0e, 0xde, 0xad, 0xbe, 0xef]]);
  });

  it("keeps them in order", async () => {
    const { stack, channel } = await open();
    stack.notify(Uint8Array.from([1]));
    stack.notify(Uint8Array.from([2]));
    stack.notify(Uint8Array.from([3]));

    const seen: number[][] = [];
    channel.subscribe((packet) => seen.push(Array.from(packet)));
    expect(seen).toEqual([[1], [2], [3]]);
  });

  it("hands them over only once", async () => {
    const { stack, channel } = await open();
    stack.notify(Uint8Array.from([1]));
    channel.subscribe(() => undefined);

    const later: number[][] = [];
    channel.subscribe((packet) => later.push(Array.from(packet)));
    expect(later).toEqual([]);
  });

  it("does not grow without bound when nobody ever listens", async () => {
    const { stack, channel } = await open();
    for (let index = 0; index < 200; index += 1) {
      stack.notify(Uint8Array.from([index & 0xff]));
    }
    const seen: number[][] = [];
    channel.subscribe((packet) => seen.push(Array.from(packet)));
    expect(seen.length).toBeLessThanOrEqual(32);
  });

  it("delivers straight to a subscriber once there is one", async () => {
    const { stack, channel } = await open();
    const seen: number[][] = [];
    channel.subscribe((packet) => seen.push(Array.from(packet)));
    stack.notify(Uint8Array.from([9]));
    expect(seen).toEqual([[9]]);
  });

  it("drops the buffer on close", async () => {
    const { stack, channel } = await open();
    stack.notify(Uint8Array.from([1]));
    await channel.close();
    const seen: number[][] = [];
    channel.subscribe((packet) => seen.push(Array.from(packet)));
    expect(seen).toEqual([]);
  });
});

describe("naming the device in errors", () => {
  it("labels the channel with the decoded UUID", async () => {
    const stack = fakeBluetooth("Dp7YKHj4nqnf1Ds8DgHfNA");
    vi.stubGlobal("navigator", { bluetooth: stack.bluetooth });
    const channel = await requestSesameChannel();
    expect(channel.deviceLabel).toBe("0E9ED828-78F8-9EA9-DFD4-3B3C0E01DF34");
  });

  it("falls back to the advertised name when it is not a UUID", async () => {
    const stack = fakeBluetooth("WM2");
    vi.stubGlobal("navigator", { bluetooth: stack.bluetooth });
    expect((await requestSesameChannel()).deviceLabel).toBe("WM2");
  });
});
