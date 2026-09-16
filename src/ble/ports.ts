/**
 * The two boundaries a Bluetooth transport is built on.
 *
 * ADR 0001 splits the Bluetooth path in two. The TurboWarp page owns the GATT
 * connection but never sees a key or a plaintext frame; a keyholder on a
 * separate origin owns the key and never touches Bluetooth. These interfaces
 * are that split, expressed so each side can be replaced or faked in tests.
 *
 * See docs/adr/0001-ble-transport-and-key-custody.md.
 */

import type { ParsingType } from "./segment.js";

/**
 * A connected Sesame device, reduced to the operations the protocol needs.
 *
 * Implemented over Web Bluetooth in the browser, and over a fake in tests. It
 * carries bytes only: whatever is written has already been encrypted and
 * segmented by the keyholder, and whatever is read is passed back unexamined.
 */
export interface GattChannel {
  /** Writes one packet to the Tx characteristic, without response. */
  write(packet: Uint8Array): Promise<void>;

  /**
   * Subscribes to the Rx characteristic. Returns a function that unsubscribes.
   */
  subscribe(listener: (packet: Uint8Array) => void): () => void;

  close(): Promise<void>;
}

export interface KeyholderSession {
  /**
   * Seals a request so it can be written to the device. The keyholder applies
   * AES-CCM under the session key and returns the packets the segment layer
   * produced, so no plaintext and no key crosses this boundary.
   */
  seal(message: Uint8Array): Promise<Uint8Array[]>;

  /** Opens a reassembled message received from the device. */
  open(parsing: ParsingType, data: Uint8Array): Promise<Uint8Array>;

  /** Releases the session key held in memory. */
  close(): Promise<void>;
}

/**
 * The origin that holds the device secret.
 *
 * The secret is imported once as a non-extractable `CryptoKey`, stored wrapped,
 * and unwrapped per session behind user verification. None of that is visible
 * here on purpose: this interface exposes only what the transport may ask for.
 */
export interface KeyholderPort {
  /** Whether a device secret has been paired for this device name. */
  isPaired(deviceName: string): Promise<boolean>;

  /**
   * Derives the session key from the four-byte random code the device
   * publishes on connect, and returns the session that seals and opens
   * messages with it.
   *
   * The session key is `AES_CMAC(device_secret, randomCode)`. The login request
   * the caller must send first carries its leading four bytes, which
   * {@link KeyholderSession.seal} produces without revealing the rest.
   */
  startSession(
    deviceName: string,
    randomCode: Uint8Array,
  ): Promise<KeyholderSession>;
}
