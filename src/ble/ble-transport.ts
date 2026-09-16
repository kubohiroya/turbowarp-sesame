/**
 * The Bluetooth transport contract.
 *
 * ADR 0001 records why this exists and how custody of the device secret is
 * arranged. This module defines the shape; the implementation follows.
 */

import type { SesameTransport, TransportCapability } from "../transport.js";
import type { GattChannel, KeyholderPort } from "./ports.js";

export interface BleTransportOptions {
  /**
   * The connected device. The caller opens it, because `requestDevice` needs
   * transient user activation and so must run from a click rather than from a
   * block evaluated in the VM's step loop.
   */
  channel: GattChannel;

  /** The origin holding the device secret. */
  keyholder: KeyholderPort;

  /**
   * Identifies which paired secret to use. Not a secret itself, in the same
   * way the broker's device alias is not.
   */
  deviceName: string;

  /**
   * Tag recorded in the device's own history list alongside each operation.
   * The protocol allows at most seven bytes.
   */
  historyTag?: string;
}

/** Longest history tag the lock and unlock item codes accept. */
export const MAX_HISTORY_TAG_BYTES = 7;

/**
 * A transport that speaks to the lock directly over Bluetooth LE.
 *
 * It differs from the cloud transports in both directions. It cannot paginate
 * history, so it omits `getHistory` and reports no `"history"` capability. It
 * can report genuine mechanical state as the device pushes it, so it provides
 * `onStatusChange` and reports `"statusEvents"`.
 */
export interface BleTransport extends SesameTransport {
  capabilities(): ReadonlySet<TransportCapability>;

  /**
   * Connects, enables notifications, waits for the four-byte random code the
   * device publishes, and logs in. Required before any other call.
   */
  connect(): Promise<void>;

  close(): Promise<void>;

  /** True once the login response has been accepted. */
  isLoggedIn(): boolean;
}

export const BLE_CAPABILITIES: ReadonlySet<TransportCapability> = new Set([
  "statusEvents",
]);
