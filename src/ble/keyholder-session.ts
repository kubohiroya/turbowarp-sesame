/**
 * The security layer of a Bluetooth session, joining AES-CMAC, AES-CCM, and
 * the segment layer.
 *
 * This runs inside the keyholder, on the keyholder's own origin. It is the only
 * code that touches keys: it takes plaintext requests and returns packets ready
 * to write, and takes reassembled frames and returns plaintext. Nothing it
 * returns lets the caller derive a key.
 *
 * See docs/adr/0001-ble-transport-and-key-custody.md.
 */

import { aesCmacWithKey } from "../aes-cmac.js";
import { importCcmKey, open, seal, type CcmKey } from "./aes-ccm.js";
import type { KeyholderSession } from "./ports.js";
import { ccmNonce } from "./protocol.js";
import { encodeSegments, type ParsingType } from "./segment.js";

/** SesameOS3 authenticates a single zero byte alongside each frame. */
const ADDITIONAL_DATA = new Uint8Array([0]);

/** SesameOS3 truncates the CCM tag to four bytes. */
const TAG_LENGTH = 4;

/** Bytes of the session token the login request carries. */
const LOGIN_PROOF_LENGTH = 4;

export interface SessionStart {
  session: KeyholderSession;
  /**
   * Payload of the login request, which is the leading four bytes of the
   * session token. The device compares only these, so the rest of the token
   * never leaves the keyholder.
   */
  loginProof: Uint8Array;
}

/**
 * Derives a session from the four-byte random code the device publishes on
 * connect.
 *
 * The session token is `AES_CMAC(device_secret, randomCode)`. The device secret
 * stays a non-extractable `CryptoKey` throughout; the token exists as bytes
 * only long enough to be imported, because Web Crypto has no way to move key
 * material between algorithms without it.
 */
export async function startSession(
  deviceSecret: CryptoKey,
  randomCode: Uint8Array,
  subtle: SubtleCrypto = crypto.subtle,
): Promise<SessionStart> {
  if (randomCode.length !== 4) {
    throw new TypeError("Sesame session random code must be four bytes.");
  }
  const token = await aesCmacWithKey(deviceSecret, randomCode, subtle);
  const sessionKey = await importCcmKey(token, subtle);
  const loginProof = token.slice(0, LOGIN_PROOF_LENGTH);
  token.fill(0);
  return {
    session: new SesameKeyholderSession(sessionKey, randomCode, subtle),
    loginProof,
  };
}

/**
 * A live session.
 *
 * Each direction carries its own counter. The counters are part of the CCM
 * initialization vector, so they must advance in step with the device: a frame
 * that is sealed but never written, or a notification dropped before it is
 * opened, desynchronizes the session and every later frame fails to
 * authenticate. Recovery is to reconnect, which draws a new random code.
 */
class SesameKeyholderSession implements KeyholderSession {
  private sentCount = 0;
  private receivedCount = 0;
  private closed = false;
  private key: CcmKey | undefined;

  public constructor(
    key: CcmKey,
    private readonly randomCode: Uint8Array,
    private readonly subtle: SubtleCrypto,
  ) {
    this.key = key;
  }

  public async seal(message: Uint8Array): Promise<Uint8Array[]> {
    const key = this.requireOpen();
    const sealed = await seal(
      {
        key,
        nonce: ccmNonce(this.sentCount, this.randomCode),
        additionalData: ADDITIONAL_DATA,
        tagLength: TAG_LENGTH,
      },
      message,
      this.subtle,
    );
    this.sentCount += 1;
    return encodeSegments({ parsing: "cipher", data: sealed });
  }

  public async open(
    parsing: ParsingType,
    data: Uint8Array,
  ): Promise<Uint8Array> {
    const key = this.requireOpen();
    // The device answers the login request in the clear, because the session
    // is only established once that request is accepted.
    if (parsing === "plain") return data;

    const plaintext = await open(
      {
        key,
        nonce: ccmNonce(this.receivedCount, this.randomCode),
        additionalData: ADDITIONAL_DATA,
        tagLength: TAG_LENGTH,
      },
      data,
      this.subtle,
    );
    // Advanced only on success, so a rejected frame does not skip a counter
    // and desynchronize a session that is otherwise intact.
    this.receivedCount += 1;
    return plaintext;
  }

  public close(): Promise<void> {
    this.closed = true;
    // Dropping the reference is what releases the key: it is non-extractable,
    // so there is no copy of the material to erase.
    this.key = undefined;
    return Promise.resolve();
  }

  private requireOpen(): CcmKey {
    if (this.closed || this.key === undefined) {
      throw new Error("This Sesame session is closed.");
    }
    return this.key;
  }
}

/**
 * Splits a plaintext request into packets.
 *
 * Only the login request travels unencrypted, before the session key has been
 * proven. Everything afterwards goes through {@link KeyholderSession.seal}.
 */
export function segmentPlaintext(message: Uint8Array): Uint8Array[] {
  return encodeSegments({ parsing: "plain", data: message });
}
