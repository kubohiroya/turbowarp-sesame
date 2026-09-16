import type { SesameCommand } from "./sesame-client.js";

/**
 * A capability a transport may or may not provide.
 *
 * `getStatus` and `sendCommand` are required of every transport, so they have
 * no capability. The rest vary: the cloud transports paginate history but
 * cannot push state changes, while a Bluetooth transport can push state
 * changes but reads history one record at a time with no pagination.
 */
export type TransportCapability = "history" | "statusEvents";

/**
 * A device status projected into the field vocabulary of the Candy House Web
 * API, so that saved projects keep reading the same field names whichever
 * transport produced the value.
 */
export type DeviceStatus = Record<string, unknown>;

export type StatusListener = (status: DeviceStatus) => void;

/** Removes a listener registered through {@link SesameTransport.onStatusChange}. */
export type Unsubscribe = () => void;

export interface SesameTransport {
  /** Reports which optional members of this interface are usable. */
  capabilities(): ReadonlySet<TransportCapability>;

  getStatus(): Promise<DeviceStatus>;

  sendCommand(command: SesameCommand, history: string): Promise<unknown>;

  /** Present only when `capabilities()` contains `"history"`. */
  getHistory?(page: number, length: number): Promise<unknown[]>;

  /**
   * Establishes the underlying session. Transports that are stateless over
   * HTTP omit this; a Bluetooth transport uses it to connect, enable
   * notifications, receive the session random code, and log in.
   */
  connect?(): Promise<void>;

  /** Releases the session opened by {@link SesameTransport.connect}. */
  close?(): Promise<void>;

  /**
   * Subscribes to unsolicited status changes. Present only when
   * `capabilities()` contains `"statusEvents"`.
   */
  onStatusChange?(listener: StatusListener): Unsubscribe;
}

export function supports(
  transport: SesameTransport,
  capability: TransportCapability,
): boolean {
  return transport.capabilities().has(capability);
}

export function requireCapability(
  transport: SesameTransport,
  capability: TransportCapability,
  explanation: string,
): void {
  if (!supports(transport, capability)) {
    throw new Error(explanation);
  }
}
