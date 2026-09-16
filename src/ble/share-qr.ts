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

/**
 * Highest product model the published documentation lists. A first byte above
 * this is not a model, which means the payload is not the record this parser
 * understands.
 */
const HIGHEST_KNOWN_MODEL = 20;

const SECRET_BYTES = 16;

/**
 * A guest key has the first half of its secret zeroed.
 *
 * The published SDK detects this exact pattern and, when it matches, requires
 * the network and asks a server to sign the session token instead of computing
 * it locally. Those eight bytes are simply not in the QR code, so a guest key
 * cannot open a Bluetooth session at all.
 */
const GUEST_SECRET_PREFIX = "0000000000000000";
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
 * the common failures are pointing the camera at the wrong code and scanning a
 * guest key, which cannot work over Bluetooth.
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

  // Newer codes carry the bare 16-byte secret in `sk` and move the device
  // identity into other query parameters. The parameter names vary, so the
  // UUID is located by its shape rather than by a name guessed in advance.
  if (record.length === SECRET_BYTES) {
    return fromBareSecret(record, query);
  }

  const model = record[0];
  if (model === undefined) {
    throw new Error("This sesame QR code is empty.");
  }
  // A leading byte outside the known range is not a product model at all, so
  // reporting a length mismatch against it would be misleading.
  if (model > HIGHEST_KNOWN_MODEL) {
    throw new Error(
      `This sesame QR code is in a format this project does not know: ${describeShape(record)}, parameters ${parameterNames(query)}. See docs/device-testing.md.`,
    );
  }
  const publicKeyBytes =
    model >= FIRST_SHORT_PUBLIC_KEY_MODEL
      ? SHORT_PUBLIC_KEY_BYTES
      : LONG_PUBLIC_KEY_BYTES;
  const expected =
    1 + SECRET_BYTES + publicKeyBytes + KEY_INDEX_BYTES + UUID_BYTES;
  if (record.length !== expected) {
    throw new Error(
      `This sesame QR code is ${record.length} bytes, but model ${model} needs ${expected}. ${describeShape(record)}, parameters ${parameterNames(query)}`,
    );
  }

  let offset = 1;
  const secret = toHex(record, offset, SECRET_BYTES);
  if (secret.startsWith(GUEST_SECRET_PREFIX)) {
    throw new Error(
      "This is a guest key, which does not contain the half of the secret that Bluetooth needs. Share an owner or manager key instead.",
    );
  }
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
 * Builds a key from values entered by hand.
 *
 * The QR code is the convenient route, not the only one. Anyone already using
 * this project's Direct mode has the same 16-byte secret and device UUID, and
 * a sesame app that shows a sharing code this parser cannot read should not
 * leave them stuck.
 */
export function sharedKeyFromParts(parts: {
  secret: string;
  uuid: string;
  model?: number;
  publicKey?: string;
  name?: string;
}): SharedKey {
  const secret = parts.secret.trim().toLowerCase().replace(/\s+/gu, "");
  if (!/^[0-9a-f]{32}$/u.test(secret)) {
    throw new Error(
      "The secret key must be exactly 32 hexadecimal characters.",
    );
  }
  if (secret.startsWith(GUEST_SECRET_PREFIX)) {
    throw new Error(
      "That is a guest key's secret, which is missing the half Bluetooth needs. Use an owner or manager key.",
    );
  }
  const uuid = parts.uuid.trim().toUpperCase();
  if (
    !/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/u.test(
      uuid,
    )
  ) {
    throw new Error(
      "The device UUID must look like 00000000-0000-0000-0000-000000000000.",
    );
  }
  const model = parts.model ?? FIRST_SHORT_PUBLIC_KEY_MODEL;
  if (!Number.isInteger(model) || model < 0 || model > HIGHEST_KNOWN_MODEL) {
    throw new Error(`Unknown product model: ${String(model)}.`);
  }
  const name = parts.name?.trim();
  return {
    model,
    secret,
    // Only SESAME 5 and later are reachable this way, and their login uses the
    // secret alone; the public key is recorded for display, not for the
    // protocol.
    publicKey: parts.publicKey ?? "",
    keyIndex: "",
    uuid,
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

/**
 * Describes an unrecognized payload well enough to identify its format, and no
 * better.
 *
 * Length and a few leading bytes place a format; they cannot reconstruct a key.
 * This exists so an unknown code can be reported without anyone being asked to
 * share the code itself, which would be sharing a credential.
 */
export function describeShape(record: Uint8Array): string {
  const head = Array.from(record.subarray(0, 4), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join(" ");
  return `${record.length} bytes beginning ${head}`;
}

/**
 * Builds a key from a code whose `sk` is the secret alone.
 *
 * The device UUID has to come from somewhere else in the URL. Rather than
 * guessing which parameter holds it, every value is checked against the shape
 * of a UUID: that shape is distinctive enough to identify, and it keeps the
 * parser working if the parameter is renamed.
 */
function fromBareSecret(secret: Uint8Array, query: URLSearchParams): SharedKey {
  const uuid = findUuid(query);
  if (uuid === undefined) {
    throw new Error(
      `This sesame QR code carries a key but no device UUID (parameters ${parameterNames(query)}). Enter the key by hand instead — see docs/device-testing.md.`,
    );
  }
  const hex = toHex(secret, 0, SECRET_BYTES);
  if (hex.startsWith(GUEST_SECRET_PREFIX)) {
    throw new Error(
      "This is a guest key, which does not contain the half of the secret that Bluetooth needs. Share an owner or manager key instead.",
    );
  }
  const level = keyLevelName(query.get("l"));
  const name = query.get("n") ?? undefined;
  const model = Number.parseInt(query.get("m") ?? "", 10);
  return {
    model:
      Number.isInteger(model) && model >= 0 && model <= HIGHEST_KNOWN_MODEL
        ? model
        : FIRST_SHORT_PUBLIC_KEY_MODEL,
    secret: hex,
    // Only SESAME 5 and later use this shorter form, and their login needs the
    // secret alone.
    publicKey: "",
    keyIndex: "",
    uuid,
    ...(level === undefined ? {} : { level }),
    ...(name === undefined || name.length === 0 ? {} : { name }),
  };
}

/** Finds the one value in the query that is shaped like a device UUID. */
function findUuid(query: URLSearchParams): string | undefined {
  for (const [name, value] of query) {
    if (name === "sk") continue;
    const candidate = value.trim().replace(/-/gu, "");
    if (/^[0-9a-f]{32}$/iu.test(candidate)) {
      const hex = candidate.toUpperCase();
      return [
        hex.slice(0, 8),
        hex.slice(8, 12),
        hex.slice(12, 16),
        hex.slice(16, 20),
        hex.slice(20, 32),
      ].join("-");
    }
  }
  return undefined;
}

/**
 * Lists the query parameter names, for reporting an unfamiliar code.
 *
 * Names identify a format; values are the credential. Only names are returned.
 */
function parameterNames(query: URLSearchParams): string {
  const names = [...new Set([...query.keys()])];
  return names.length === 0 ? "(none)" : names.join(", ");
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
  // URLSearchParams decodes "+" as a space, and the payload is standard base64
  // where "+" is a real character. Restoring it is not optional: atob strips
  // whitespace rather than failing, so a lost "+" silently shifts every byte
  // after it and yields plausible-looking garbage.
  const normalized = value
    .replace(/ /gu, "+")
    .replace(/-/gu, "+")
    .replace(/_/gu, "/");
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
