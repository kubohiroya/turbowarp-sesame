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
    filters?: Array<{ services?: Array<string | number> }>;
    optionalServices?: Array<string | number>;
  }): Promise<BluetoothDeviceLike>;
}

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
export async function requestSesameChannel(): Promise<GattChannel> {
  const api = bluetooth();
  if (api === undefined) {
    throw new Error(
      "This browser has no Web Bluetooth. Chrome or Edge on desktop or Android is required; use Relay mode otherwise.",
    );
  }
  const device = await api.requestDevice({
    filters: [{ services: [SERVICE_UUID] }],
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
  await rx.startNotifications();
  return new WebBluetoothChannel(connected, tx, rx, device.name);
}

class WebBluetoothChannel implements GattChannel {
  private readonly listeners = new Set<(packet: Uint8Array) => void>();
  private closed = false;

  public constructor(
    private readonly server: BluetoothServer,
    private readonly tx: BluetoothCharacteristic,
    private readonly rx: BluetoothCharacteristic,
    public readonly deviceName: string | undefined,
  ) {
    this.rx.addEventListener("characteristicvaluechanged", this.onValue);
  }

  public async write(packet: Uint8Array): Promise<void> {
    if (this.closed) throw new Error("This Bluetooth connection is closed.");
    // A fresh buffer each time: the browser may keep the view past this call.
    await this.tx.writeValueWithoutResponse(packet.slice());
  }

  public subscribe(listener: (packet: Uint8Array) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
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
    for (const listener of [...this.listeners]) listener(packet);
  };
}

function bluetooth(): BluetoothLike | undefined {
  const candidate = (
    globalThis as { navigator?: { bluetooth?: BluetoothLike } }
  ).navigator?.bluetooth;
  return typeof candidate?.requestDevice === "function" ? candidate : undefined;
}
