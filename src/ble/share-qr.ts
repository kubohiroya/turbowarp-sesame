/**
 * Parser for the share QR code the sesame app displays.
 *
 * The code holds an `ssm://UI` URL whose `sk` parameter is a base64 record
 * containing everything a Bluetooth session needs: the product model, the
 * device secret, the device's public key, a key index, and the device UUID.
 *
 * Encoding taken from the published SDK's `URL+Sesame2.swift`.
 *
 * This runs inside the keyholder, never in the TurboWarp page: the record
 * carries the secret in cleartext, so whoever parses it holds the secret. See
 * docs/adr/0001-ble-transport-and-key-custody.md.
 */

const URL_PREFIX = "ssm://UI";

/**
 * The first product model that carries a four-byte public key. Earlier models
 * carry sixty-four.
 */
const FIRST_SHORT_PUBLIC_KEY_MODEL = 5;

const SHORT_PUBLIC_KEY_BYTES = 4;
const LONG_PUBLIC_KEY_BYTES = 64;

const SECRET_BYTES = 16;
const KEY_INDEX_BYTES = 2;
const UUID_BYTES = 16;

/**
 * How the app labelled the shared key.
 *
 * Advisory only. It travels beside the payload rather than inside it, it is
 * neither encrypted nor authenticated, and the Bluetooth protocol has no
 * notion of it. Show it; never enforce with it.
 */
export const KeyLevel = {
  owner: 0,
  manager: 1,
  guest: 2,
} as const;

export type KeyLevelName = keyof typeof KeyLevel;

export interface SharedKey {
  /** Product model byte. 5 is SESAME 5, 7 is SESAME 5 Pro. */
  model: number;
  /** The 16-byte device secret, as lowercase hexadecimal. */
  secret: string;
  /** The device's public key, as lowercase hexadecimal. */
  publicKey: string;
  keyIndex: string;
  /** Device UUID in the canonical dashed form, uppercased as the API uses it. */
  uuid: string;
  /** Advisory key level, when the URL carried a recognizable one. */
  level?: KeyLevelName;
  /** Device name the sharer chose, when the URL carried one. */
  name?: string;
}

/**
 * Parses the text decoded from a share QR code.
 *
 * Throws with a message suitable for showing to the person scanning, because
 * the common failures are pointing the camera at the wrong code.
 */
export function parseShareQr(text: string): SharedKey {
  const trimmed = text.trim();
  if (!trimmed.startsWith(URL_PREFIX)) {
    throw new Error("This is not a sesame sharing QR code.");
  }
  const query = new URLSearchParams(trimmed.slice(trimmed.indexOf("?") + 1));
  if (query.get("t") !== "sk") {
    throw new Error(
      "This sesame QR code does not share a key. Choose the key sharing code in the sesame app.",
    );
  }
  const encoded = query.get("sk");
  if (encoded === null || encoded.length === 0) {
    throw new Error("This sesame QR code carries no key.");
  }

  const record = decodeBase64(encoded);
  const model = record[0];
  if (model === undefined) {
    throw new Error("This sesame QR code is empty.");
  }
  const publicKeyBytes =
    model >= FIRST_SHORT_PUBLIC_KEY_MODEL
      ? SHORT_PUBLIC_KEY_BYTES
      : LONG_PUBLIC_KEY_BYTES;
  const expected =
    1 + SECRET_BYTES + publicKeyBytes + KEY_INDEX_BYTES + UUID_BYTES;
  if (record.length !== expected) {
    throw new Error(
      `This sesame QR code is ${record.length} bytes, but model ${model} needs ${expected}.`,
    );
  }

  let offset = 1;
  const secret = toHex(record, offset, SECRET_BYTES);
  offset += SECRET_BYTES;
  const publicKey = toHex(record, offset, publicKeyBytes);
  offset += publicKeyBytes;
  const keyIndex = toHex(record, offset, KEY_INDEX_BYTES);
  offset += KEY_INDEX_BYTES;
  const uuid = toUuid(record, offset);

  const level = keyLevelName(query.get("l"));
  const name = query.get("n") ?? undefined;
  return {
    model,
    secret,
    publicKey,
    keyIndex,
    uuid,
    ...(level === undefined ? {} : { level }),
    ...(name === undefined || name.length === 0 ? {} : { name }),
  };
}

/**
 * Returns the record with its secret replaced, for logging or display.
 *
 * Parsed keys should not be printed, stored, or sent anywhere; where one has to
 * be shown, this is what to show.
 */
export function redact(key: SharedKey): SharedKey {
  return { ...key, secret: "[redacted]" };
}

function keyLevelName(value: string | null): KeyLevelName | undefined {
  if (value === null) return undefined;
  const parsed = Number.parseInt(value, 10);
  for (const [name, level] of Object.entries(KeyLevel)) {
    if (level === parsed) return name as KeyLevelName;
  }
  return undefined;
}

function decodeBase64(value: string): Uint8Array {
  // The app percent-encodes the value into the URL, so "+" survives as "+"
  // through URLSearchParams; accept the URL-safe alphabet as well.
  const normalized = value.replace(/-/gu, "+").replace(/_/gu, "/");
  let binary: string;
  try {
    binary = atob(normalized);
  } catch {
    throw new Error("This sesame QR code is not valid base64.");
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toHex(data: Uint8Array, offset: number, length: number): string {
  let result = "";
  for (let index = offset; index < offset + length; index += 1) {
    result += (data[index] ?? 0).toString(16).padStart(2, "0");
  }
  return result;
}

function toUuid(data: Uint8Array, offset: number): string {
  const hex = toHex(data, offset, UUID_BYTES).toUpperCase();
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}
