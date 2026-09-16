/**
 * Deriving the key-encryption key that protects a stored device secret.
 *
 * Two sources, in order of preference:
 *
 * 1. A platform authenticator through the WebAuthn PRF extension. The key
 *    material never exists until the person approves with Touch ID, Windows
 *    Hello, or the equivalent, and it cannot be reproduced on another device.
 * 2. A passphrase through PBKDF2, where PRF is unavailable.
 *
 * Neither key is stored. Both are derived per session and dropped with the page.
 */

import type { Protection } from "./storage.js";

/** Cost chosen to be noticeable to an attacker and tolerable once per session. */
export const PBKDF2_ITERATIONS = 600_000;

const KEK_ALGORITHM = { name: "AES-GCM", length: 256 } as const;
const INFO = new TextEncoder().encode("sesame-keyholder/kek/v1");

interface PrfResults {
  results?: { first?: ArrayBuffer };
  enabled?: boolean;
}

interface PublicKeyCredentialLike {
  rawId: ArrayBuffer;
  getClientExtensionResults(): { prf?: PrfResults };
}

/** True when this browser exposes WebAuthn at all. */
export function isWebAuthnAvailable(): boolean {
  return (
    typeof globalThis.PublicKeyCredential !== "undefined" &&
    typeof navigator !== "undefined" &&
    typeof navigator.credentials?.get === "function"
  );
}

/**
 * Creates a passkey for this origin and returns its credential id.
 *
 * PRF output is not reliably delivered at creation time, so the caller derives
 * the key afterwards with {@link deriveFromPrf}, which prompts once more.
 */
export async function createPasskey(
  deviceName: string,
  subtle: SubtleCrypto = crypto.subtle,
): Promise<{ credentialId: Uint8Array; salt: Uint8Array }> {
  void subtle;
  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: "Sesame keyholder" },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: deviceName,
        displayName: `Sesame ${deviceName}`,
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required",
      },
      extensions: { prf: {} },
    } as PublicKeyCredentialCreationOptions,
  })) as PublicKeyCredentialLike | null;

  if (credential === null) {
    throw new Error("No passkey was created.");
  }
  if (credential.getClientExtensionResults().prf?.enabled === false) {
    throw new Error(
      "This passkey cannot protect a key. Use a passphrase instead.",
    );
  }
  return {
    credentialId: new Uint8Array(credential.rawId),
    salt: crypto.getRandomValues(new Uint8Array(32)),
  };
}

/**
 * Asks the authenticator to evaluate its pseudo-random function over `salt`.
 *
 * This is the gesture that unlocks the door: without it the stored blob cannot
 * be unwrapped.
 */
export async function deriveFromPrf(
  credentialId: Uint8Array,
  salt: Uint8Array,
  subtle: SubtleCrypto = crypto.subtle,
): Promise<CryptoKey> {
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [
        { type: "public-key", id: toArrayBuffer(credentialId) },
      ],
      userVerification: "required",
      extensions: { prf: { eval: { first: toArrayBuffer(salt) } } },
    } as PublicKeyCredentialRequestOptions,
  })) as PublicKeyCredentialLike | null;

  const first = assertion?.getClientExtensionResults().prf?.results?.first;
  if (first === undefined) {
    throw new Error(
      "This passkey did not return key material. Pair again with a passphrase.",
    );
  }
  return hkdf(new Uint8Array(first), salt, subtle);
}

/** Derives the same key from a passphrase, for browsers without PRF. */
export async function deriveFromPassphrase(
  passphrase: string,
  salt: Uint8Array,
  iterations: number = PBKDF2_ITERATIONS,
  subtle: SubtleCrypto = crypto.subtle,
): Promise<CryptoKey> {
  if (passphrase.length < 8) {
    throw new TypeError("A passphrase must be at least eight characters.");
  }
  const base = await subtle.importKey(
    "raw",
    toArrayBuffer(new TextEncoder().encode(passphrase)),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: toArrayBuffer(salt),
      iterations,
      hash: "SHA-256",
    },
    base,
    KEK_ALGORITHM,
    false,
    ["wrapKey", "unwrapKey"],
  );
}

/** Derives the key-encryption key a stored record calls for. */
export async function deriveFor(
  protection: Protection,
  passphrase: () => Promise<string>,
  subtle: SubtleCrypto = crypto.subtle,
): Promise<CryptoKey> {
  return protection.kind === "webauthn-prf"
    ? deriveFromPrf(protection.credentialId, protection.salt, subtle)
    : deriveFromPassphrase(
        await passphrase(),
        protection.salt,
        protection.iterations,
        subtle,
      );
}

async function hkdf(
  material: Uint8Array,
  salt: Uint8Array,
  subtle: SubtleCrypto,
): Promise<CryptoKey> {
  const base = await subtle.importKey(
    "raw",
    toArrayBuffer(material),
    "HKDF",
    false,
    ["deriveKey"],
  );
  material.fill(0);
  return subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: toArrayBuffer(salt),
      info: toArrayBuffer(INFO),
    },
    base,
    KEK_ALGORITHM,
    false,
    ["wrapKey", "unwrapKey"],
  );
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.slice().buffer as ArrayBuffer;
}
