/**
 * AES-CCM over Web Crypto.
 *
 * Web Crypto implements GCM, CBC, and CTR but not CCM, which SesameOS3's
 * security layer requires. CCM is CTR encryption plus a CBC-MAC authentication
 * tag (NIST SP 800-38C, RFC 3610), so both halves are built here from the
 * primitives the browser does provide.
 *
 * Keys are `CryptoKey` values, never raw bytes, so a key imported with
 * `extractable: false` stays unreadable to JavaScript for its whole lifetime.
 * CTR and CBC are separate Web Crypto algorithms and a key belongs to exactly
 * one of them, so a CCM key is a pair of imports of the same material — see
 * {@link importCcmKey}.
 */

const BLOCK_SIZE = 16;

/** The two Web Crypto keys CCM needs: CBC for the tag, CTR for the payload. */
export interface CcmKey {
  /** Used for the CBC-MAC that produces the authentication tag. */
  cbc: CryptoKey;
  /** Used for the counter-mode keystream. */
  ctr: CryptoKey;
}

export interface CcmParameters {
  key: CcmKey;
  /** 7 to 13 bytes. SesameOS3 uses 13. */
  nonce: Uint8Array;
  /** Authenticated but not encrypted. SesameOS3 uses a single zero byte. */
  additionalData?: Uint8Array;
  /** 4, 6, 8, 10, 12, 14, or 16 bytes. SesameOS3 uses 4. */
  tagLength?: number;
}

/**
 * Imports one key's material as the algorithm pair CCM needs.
 *
 * Both imports are non-extractable, so the material cannot be read back out
 * afterwards. The caller should discard its copy of `raw` once this resolves.
 */
export async function importCcmKey(
  raw: Uint8Array,
  subtle: SubtleCrypto = crypto.subtle,
): Promise<CcmKey> {
  const material = toArrayBuffer(raw);
  const [cbc, ctr] = await Promise.all([
    subtle.importKey("raw", material, { name: "AES-CBC" }, false, ["encrypt"]),
    subtle.importKey("raw", material, { name: "AES-CTR" }, false, ["encrypt"]),
  ]);
  return { cbc, ctr };
}

/**
 * Encrypts and authenticates, returning the ciphertext and tag separately.
 *
 * The ciphertext is the same length as the plaintext; the tag is `tagLength`
 * bytes.
 */
export async function encrypt(
  parameters: CcmParameters,
  plaintext: Uint8Array,
  subtle: SubtleCrypto = crypto.subtle,
): Promise<{ ciphertext: Uint8Array; tag: Uint8Array }> {
  const options = normalize(parameters, plaintext.length);
  const mac = await cbcMac(options, plaintext, subtle);
  const keystream = await counterKeystream(options, plaintext.length, subtle);
  return {
    ciphertext: xor(plaintext, keystream.subarray(BLOCK_SIZE)),
    tag: xor(mac, keystream.subarray(0, options.tagLength)),
  };
}

/**
 * Verifies the tag and decrypts.
 *
 * Throws without returning any plaintext when the tag does not match, so a
 * forged or corrupted frame cannot be acted on.
 */
export async function decrypt(
  parameters: CcmParameters,
  ciphertext: Uint8Array,
  tag: Uint8Array,
  subtle: SubtleCrypto = crypto.subtle,
): Promise<Uint8Array> {
  const options = normalize(parameters, ciphertext.length);
  if (tag.length !== options.tagLength) {
    throw new Error(
      `AES-CCM tag must be ${options.tagLength} bytes, received ${tag.length}.`,
    );
  }
  const keystream = await counterKeystream(options, ciphertext.length, subtle);
  const plaintext = xor(ciphertext, keystream.subarray(BLOCK_SIZE));
  const mac = await cbcMac(options, plaintext, subtle);
  const expected = xor(mac, keystream.subarray(0, options.tagLength));
  if (!equalInConstantTime(expected, tag)) {
    throw new Error("AES-CCM authentication tag mismatch.");
  }
  return plaintext;
}

/** Encrypts and returns ciphertext with the tag appended, as CCM is often framed. */
export async function seal(
  parameters: CcmParameters,
  plaintext: Uint8Array,
  subtle: SubtleCrypto = crypto.subtle,
): Promise<Uint8Array> {
  const { ciphertext, tag } = await encrypt(parameters, plaintext, subtle);
  const sealed = new Uint8Array(ciphertext.length + tag.length);
  sealed.set(ciphertext);
  sealed.set(tag, ciphertext.length);
  return sealed;
}

/** Splits a trailing tag from the ciphertext and decrypts. */
export async function open(
  parameters: CcmParameters,
  sealed: Uint8Array,
  subtle: SubtleCrypto = crypto.subtle,
): Promise<Uint8Array> {
  const tagLength = parameters.tagLength ?? 4;
  if (sealed.length < tagLength) {
    throw new Error("AES-CCM frame is shorter than its authentication tag.");
  }
  const split = sealed.length - tagLength;
  return decrypt(
    parameters,
    sealed.subarray(0, split),
    sealed.subarray(split),
    subtle,
  );
}

interface Options {
  key: CcmKey;
  nonce: Uint8Array;
  additionalData: Uint8Array;
  tagLength: number;
  /** Size of the length field, 15 minus the nonce length. */
  lengthSize: number;
}

function normalize(parameters: CcmParameters, dataLength: number): Options {
  const tagLength = parameters.tagLength ?? 4;
  if (tagLength < 4 || tagLength > 16 || tagLength % 2 !== 0) {
    throw new TypeError(
      "AES-CCM tag length must be an even number of bytes from 4 to 16.",
    );
  }
  const nonceLength = parameters.nonce.length;
  if (nonceLength < 7 || nonceLength > 13) {
    throw new TypeError("AES-CCM nonce must be 7 to 13 bytes.");
  }
  const lengthSize = 15 - nonceLength;
  // A length field of n bytes can only describe 2^(8n) - 1 bytes of payload.
  if (lengthSize < 8 && dataLength >= 2 ** (8 * lengthSize)) {
    throw new TypeError(
      `AES-CCM payload of ${dataLength} bytes does not fit a ${lengthSize}-byte length field.`,
    );
  }
  return {
    key: parameters.key,
    nonce: parameters.nonce,
    additionalData: parameters.additionalData ?? new Uint8Array(),
    tagLength,
    lengthSize,
  };
}

/**
 * Computes the CBC-MAC over the first block, the encoded additional data, and
 * the zero-padded payload, and returns its leading `tagLength` bytes.
 */
async function cbcMac(
  options: Options,
  plaintext: Uint8Array,
  subtle: SubtleCrypto,
): Promise<Uint8Array> {
  const blocks = concat([
    firstBlock(options, plaintext.length),
    encodeAdditionalData(options.additionalData),
    padToBlock(plaintext),
  ]);
  // AES-CBC chaining over a zero IV is exactly CBC-MAC. Web Crypto always
  // appends a PKCS#7 block, so the final real block sits just before it.
  const encrypted = new Uint8Array(
    await subtle.encrypt(
      { name: "AES-CBC", iv: new Uint8Array(BLOCK_SIZE) },
      options.key.cbc,
      toArrayBuffer(blocks),
    ),
  );
  const end = encrypted.length - BLOCK_SIZE;
  return encrypted.slice(
    end - BLOCK_SIZE,
    end - BLOCK_SIZE + options.tagLength,
  );
}

/**
 * Produces the counter-mode keystream, with the tag-masking block S_0 first
 * and the payload keystream after it.
 */
async function counterKeystream(
  options: Options,
  dataLength: number,
  subtle: SubtleCrypto,
): Promise<Uint8Array> {
  const counter = new Uint8Array(BLOCK_SIZE);
  counter[0] = options.lengthSize - 1;
  counter.set(options.nonce, 1);
  // Counter index stays zero: S_0 masks the tag, and AES-CTR increments from
  // there for each payload block.
  const blocks = Math.ceil(dataLength / BLOCK_SIZE) + 1;
  const encrypted = await subtle.encrypt(
    { name: "AES-CTR", counter, length: options.lengthSize * 8 },
    options.key.ctr,
    new ArrayBuffer(blocks * BLOCK_SIZE),
  );
  return new Uint8Array(encrypted);
}

function firstBlock(options: Options, dataLength: number): Uint8Array {
  const block = new Uint8Array(BLOCK_SIZE);
  const hasAdditionalData = options.additionalData.length > 0 ? 1 : 0;
  block[0] =
    hasAdditionalData * 64 +
    ((options.tagLength - 2) / 2) * 8 +
    (options.lengthSize - 1);
  block.set(options.nonce, 1);
  writeBigEndian(block, BLOCK_SIZE - options.lengthSize, dataLength);
  return block;
}

/**
 * Encodes the additional data as a length prefix followed by the data, padded
 * to a block boundary. Only the short form is implemented, which covers any
 * additional data a Sesame frame carries.
 */
function encodeAdditionalData(additionalData: Uint8Array): Uint8Array {
  if (additionalData.length === 0) return new Uint8Array();
  if (additionalData.length >= 0xff00) {
    throw new TypeError(
      "AES-CCM additional data above 65280 bytes is not supported.",
    );
  }
  const prefixed = new Uint8Array(additionalData.length + 2);
  writeBigEndian(prefixed, 0, additionalData.length, 2);
  prefixed.set(additionalData, 2);
  return padToBlock(prefixed);
}

function padToBlock(data: Uint8Array): Uint8Array {
  if (data.length % BLOCK_SIZE === 0) return data;
  const padded = new Uint8Array(
    Math.ceil(data.length / BLOCK_SIZE) * BLOCK_SIZE,
  );
  padded.set(data);
  return padded;
}

function writeBigEndian(
  target: Uint8Array,
  offset: number,
  value: number,
  size: number = target.length - offset,
): void {
  let remaining = value;
  for (let index = size - 1; index >= 0; index -= 1) {
    target[offset + index] = remaining & 0xff;
    remaining = Math.floor(remaining / 256);
  }
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function xor(data: Uint8Array, mask: Uint8Array): Uint8Array {
  const result = new Uint8Array(data.length);
  for (let index = 0; index < data.length; index += 1) {
    result[index] = (data[index] ?? 0) ^ (mask[index] ?? 0);
  }
  return result;
}

function equalInConstantTime(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength,
  ) as ArrayBuffer;
}
