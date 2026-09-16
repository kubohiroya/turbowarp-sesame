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
import type { KeyLevelName } from "./share-qr.js";

/**
 * A connected Sesame device, reduced to the operations the protocol needs.
 *
 * Implemented over Web Bluetooth in the browser, and over a fake in tests. It
 * carries bytes only: whatever is written has already been encrypted and
 * segmented by the keyholder, and whatever is read is passed back unexamined.
 */
export interface GattChannel {
  /**
   * How to refer to this device when something goes wrong.
   *
   * A Sesame advertises the base64 of its UUID rather than a readable name, so
   * naming the device in an error is what lets someone tell they picked the
   * wrong entry out of the browser's chooser.
   */
  readonly deviceLabel?: string | undefined;

  /** Writes one packet to the Tx characteristic, without response. */
  write(packet: Uint8Array): Promise<void>;

  /**
   * Subscribes to the Rx characteristic. Returns a function that unsubscribes.
   */
  subscribe(listener: (packet: Uint8Array) => void): () => void;

  close(): Promise<void>;
}

export interface SessionStart {
  session: KeyholderSession;

  /**
   * Payload of the login request: the leading four bytes of the session token.
   *
   * The device compares only these four, so the rest of the token never leaves
   * the keyholder. They are a truncated MAC over a random code the device
   * broadcast in the clear, so they reveal nothing about the device secret and
   * are useless once that session ends.
   */
  loginProof: Uint8Array;
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
   * Pairs a device by scanning the share QR code the sesame app displays.
   *
   * Opens a top-level window on the keyholder origin, because the camera is
   * gated by a Permissions Policy that defaults to `self` and TurboWarp grants
   * no `allow="camera"` to a frame. Scanning there also keeps the secret out of
   * the TurboWarp page: the QR carries it in cleartext, so whoever decodes it
   * holds it.
   *
   * Resolves with what may safely be shown, never with the secret. Must be
   * called from a user gesture, since opening the window depends on one.
   */
  pair(): Promise<PairedDevice>;

  /**
   * Derives the session key from the four-byte random code the device
   * publishes on connect, and returns the session that seals and opens
   * messages with it.
   *
   * The session key is `AES_CMAC(device_secret, randomCode)`.
   */
  startSession(
    deviceName: string,
    randomCode: Uint8Array,
  ): Promise<SessionStart>;
}

/** What pairing reveals to the caller. Deliberately excludes the secret. */
export interface PairedDevice {
  /** Name to pass to {@link KeyholderPort.startSession}. */
  deviceName: string;

  /** Device UUID, when the sharing code carried one. For display only. */
  uuid?: string;

  /**
   * Key level the QR code claimed, when it claimed one.
   *
   * Advisory. It is unauthenticated and the Bluetooth protocol does not act on
   * it, so show it and do not enforce with it.
   */
  level?: KeyLevelName;
}
