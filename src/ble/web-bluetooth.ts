/**
 * A {@link GattChannel} over Web Bluetooth.
 *
 * This is the byte pipe of ADR 0001: it runs in the TurboWarp page and carries
 * packets the keyholder already sealed. It never sees a key or a plaintext
 * frame.
 *
 * Web Bluetooth types are declared here rather than pulled in as a dependency,
 * because only this narrow slice is used.
 */

import type { GattChannel } from "./ports.js";
import {
  RX_CHARACTERISTIC_UUID,
  SERVICE_UUID,
  TX_CHARACTERISTIC_UUID,
} from "./protocol.js";

interface BluetoothCharacteristic {
  writeValueWithoutResponse(value: BufferSource): Promise<void>;
  startNotifications(): Promise<BluetoothCharacteristic>;
  stopNotifications(): Promise<BluetoothCharacteristic>;
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
  readonly value?: DataView;
}

interface BluetoothService {
  getCharacteristic(uuid: string): Promise<BluetoothCharacteristic>;
}

interface BluetoothServer {
  connect(): Promise<BluetoothServer>;
  disconnect(): void;
  readonly connected: boolean;
  getPrimaryService(uuid: string | number): Promise<BluetoothService>;
}

interface BluetoothDeviceLike {
  readonly name?: string;
  readonly gatt?: BluetoothServer;
  addEventListener(type: string, listener: (event: Event) => void): void;
}

interface BluetoothLike {
  requestDevice(options: {
    filters?: Array<{ services?: Array<string | number>; name?: string }>;
    optionalServices?: Array<string | number>;
  }): Promise<BluetoothDeviceLike>;
}

/**
 * Recovers a device UUID from the name a Sesame advertises.
 *
 * Observed on real hardware: the advertised local name is the base64 of the
 * device's 16-byte UUID, so the browser's chooser lists entries like
 * `Dp7YKHj4nqnf1Ds8DgHfNA` rather than anything a person would recognise.
 * Decoding it turns that into the UUID the sesame app shows, which is the only
 * way to tell one lock from another in that list.
 *
 * Returns undefined for a name that is not a UUID in disguise, including the
 * plain names other Candy House products use — a WiFi Module 2 advertises
 * `WM2`.
 */
export function deviceUuidFromName(
  name: string | undefined,
): string | undefined {
  if (name === undefined) return undefined;
  const padded = name.padEnd(name.length + ((4 - (name.length % 4)) % 4), "=");
  let binary: string;
  try {
    binary = atob(padded.replace(/-/gu, "+").replace(/_/gu, "/"));
  } catch {
    return undefined;
  }
  if (binary.length !== 16) return undefined;
  const hex = Array.from(binary, (character) =>
    character.charCodeAt(0).toString(16).padStart(2, "0"),
  )
    .join("")
    .toUpperCase();
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/** The name a device with this UUID advertises, for filtering the chooser. */
export function nameForDeviceUuid(uuid: string): string {
  const hex = uuid.replace(/-/gu, "");
  const bytes = hex.match(/.{2}/gu) ?? [];
  return btoa(
    bytes
      .map((pair) => String.fromCharCode(Number.parseInt(pair, 16)))
      .join(""),
  ).replace(/=+$/u, "");
}

/** Enough for a session start; a channel with no listener is not a queue. */
const MAX_EARLY_PACKETS = 32;

/** True when this browser exposes Web Bluetooth at all. */
export function isWebBluetoothAvailable(): boolean {
  return bluetooth() !== undefined;
}

/**
 * Opens the browser's device chooser and connects to the chosen Sesame.
 *
 * Must be called from a user gesture: `requestDevice` requires transient user
 * activation, which a block evaluated in the VM's step loop only has for a few
 * seconds after a click.
 */
export async function requestSesameChannel(
  uuid?: string,
): Promise<GattChannel> {
  const api = bluetooth();
  if (api === undefined) {
    throw new Error(
      "This browser has no Web Bluetooth. Chrome or Edge on desktop or Android is required; use Relay mode otherwise.",
    );
  }
  // Filtering on the service alone lists every Candy House product in range,
  // under names that are base64 rather than anything readable. When the paired
  // key names its lock, the chooser is narrowed to that one device.
  const byName =
    uuid === undefined
      ? []
      : [{ name: nameForDeviceUuid(uuid), services: [SERVICE_UUID] }];
  const device = await api.requestDevice({
    filters: [...byName, { services: [SERVICE_UUID] }],
    optionalServices: [SERVICE_UUID],
  });
  const server = device.gatt;
  if (server === undefined) {
    throw new Error("This Bluetooth device offers no GATT server.");
  }
  const connected = await server.connect();
  const service = await connected.getPrimaryService(SERVICE_UUID);
  const [tx, rx] = await Promise.all([
    service.getCharacteristic(TX_CHARACTERISTIC_UUID),
    service.getCharacteristic(RX_CHARACTERISTIC_UUID),
  ]);
  // Buffering starts here: the constructor attaches the listener, and any
  // publish that beats the transport's subscribe is kept rather than dropped.
  const channel = new WebBluetoothChannel(connected, tx, rx, device.name);
  await rx.startNotifications();
  return channel;
}

class WebBluetoothChannel implements GattChannel {
  public readonly deviceLabel: string | undefined;
  private readonly listeners = new Set<(packet: Uint8Array) => void>();
  /**
   * Notifications that arrived before anyone subscribed.
   *
   * A Sesame publishes its session random code as soon as notifications are
   * enabled, which happens here while the caller is still constructing the
   * transport that will listen. Without this buffer that publish is delivered
   * to nobody and lost — and it is sent once per connection, so the session
   * could never start. That is what made a real lock look like it was
   * ignoring us.
   */
  private early: Uint8Array[] = [];
  private closed = false;

  public constructor(
    private readonly server: BluetoothServer,
    private readonly tx: BluetoothCharacteristic,
    private readonly rx: BluetoothCharacteristic,
    public readonly deviceName: string | undefined,
  ) {
    const uuid = deviceUuidFromName(deviceName);
    this.deviceLabel = uuid ?? deviceName;
    this.rx.addEventListener("characteristicvaluechanged", this.onValue);
  }

  public async write(packet: Uint8Array): Promise<void> {
    if (this.closed) throw new Error("This Bluetooth connection is closed.");
    // A fresh buffer each time: the browser may keep the view past this call.
    await this.tx.writeValueWithoutResponse(packet.slice());
  }

  public subscribe(listener: (packet: Uint8Array) => void): () => void {
    this.listeners.add(listener);
    // Hand over anything that arrived before there was anyone to hand it to.
    const buffered = this.early;
    this.early = [];
    for (const packet of buffered) listener(packet);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.early = [];
    this.rx.removeEventListener("characteristicvaluechanged", this.onValue);
    this.listeners.clear();
    try {
      await this.rx.stopNotifications();
    } catch {
      // The device may already be gone; disconnecting is what matters.
    }
    if (this.server.connected) this.server.disconnect();
  }

  private readonly onValue = (event: Event): void => {
    const target = event.target as BluetoothCharacteristic | null;
    const value = target?.value;
    if (value === undefined) return;
    const packet = new Uint8Array(
      value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength),
    );
    if (this.listeners.size === 0) {
      // Bounded, so a channel nobody ever listens to cannot grow without end.
      if (this.early.length < MAX_EARLY_PACKETS) this.early.push(packet);
      return;
    }
    for (const listener of [...this.listeners]) listener(packet);
  };
}

function bluetooth(): BluetoothLike | undefined {
  const candidate = (
    globalThis as { navigator?: { bluetooth?: BluetoothLike } }
  ).navigator?.bluetooth;
  return typeof candidate?.requestDevice === "function" ? candidate : undefined;
}
