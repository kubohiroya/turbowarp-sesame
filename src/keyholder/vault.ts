/**
 * Custody of device secrets.
 *
 * A secret arrives once, from a sharing QR code, and is immediately wrapped
 * under a key-encryption key the vault does not store. What remains on disk is
 * useless without a platform authenticator gesture or the passphrase.
 *
 * Unwrapping produces a non-extractable `CryptoKey`, so from that point the
 * secret cannot be read back out by any code, including this module.
 */

import type { SharedKey } from "../ble/share-qr.js";
import type { Protection, VaultRecord, VaultStorage } from "./storage.js";

const WRAP_ALGORITHM = "AES-GCM";
const IV_BYTES = 12;

export interface PairedRecord {
  deviceName: string;
  uuid?: string;
  level?: string;
  pairedAt: number;
}

export class Vault {
  public constructor(
    private readonly storage: VaultStorage,
    private readonly subtle: SubtleCrypto = crypto.subtle,
    private readonly randomBytes: (length: number) => Uint8Array = (length) =>
      crypto.getRandomValues(new Uint8Array(length)),
  ) {}

  /**
   * Stores a shared key wrapped under `kek`.
   *
   * The secret is importable for only as long as wrapping takes: it is brought
   * in as an extractable key, wrapped, and dropped. Nothing else in the
   * keyholder ever sees an extractable copy.
   */
  public async pair(
    deviceName: string,
    key: SharedKey,
    kek: CryptoKey,
    protection: Protection,
  ): Promise<PairedRecord> {
    const alias = normalizeDeviceName(deviceName);
    const secret = hexToBytes(key.secret);
    const importable = await this.subtle.importKey(
      "raw",
      toArrayBuffer(secret),
      { name: "AES-CBC" },
      true,
      ["encrypt"],
    );
    secret.fill(0);

    const wrapIv = this.randomBytes(IV_BYTES);
    const wrapped = new Uint8Array(
      await this.subtle.wrapKey("raw", importable, kek, {
        name: WRAP_ALGORITHM,
        iv: toArrayBuffer(wrapIv),
      }),
    );

    const record: VaultRecord = {
      deviceName: alias,
      ...(key.uuid === undefined ? {} : { uuid: key.uuid }),
      model: key.model,
      publicKey: key.publicKey,
      ...(key.level === undefined ? {} : { level: key.level }),
      wrappedSecret: wrapped,
      wrapIv,
      protection,
      pairedAt: Date.now(),
    };
    await this.storage.put(record);
    return toPairedRecord(record);
  }

  /** Reports how a device's key-encryption key must be derived. */
  public async protectionFor(deviceName: string): Promise<Protection> {
    return (await this.require(normalizeDeviceName(deviceName))).protection;
  }

  /**
   * Unwraps a device secret for one session.
   *
   * The result is non-extractable and usable only for AES-CMAC, which is all
   * the Bluetooth protocol needs from the long-term secret.
   */
  public async unlock(deviceName: string, kek: CryptoKey): Promise<CryptoKey> {
    const record = await this.require(normalizeDeviceName(deviceName));
    try {
      return await this.subtle.unwrapKey(
        "raw",
        toArrayBuffer(record.wrappedSecret),
        kek,
        { name: WRAP_ALGORITHM, iv: toArrayBuffer(record.wrapIv) },
        { name: "AES-CBC" },
        false,
        ["encrypt"],
      );
    } catch {
      throw new Error(
        "The key could not be unlocked. Use the same passkey or passphrase that paired it.",
      );
    }
  }

  public async has(deviceName: string): Promise<boolean> {
    return (
      (await this.storage.get(normalizeDeviceName(deviceName))) !== undefined
    );
  }

  public async list(): Promise<PairedRecord[]> {
    return (await this.storage.list()).map(toPairedRecord);
  }

  public async forget(deviceName: string): Promise<void> {
    await this.storage.delete(normalizeDeviceName(deviceName));
  }

  private async require(deviceName: string): Promise<VaultRecord> {
    const record = await this.storage.get(deviceName);
    if (record === undefined) {
      throw new Error(`No Sesame is paired as "${deviceName}".`);
    }
    return record;
  }
}

/**
 * Device aliases are shown to people and used as storage keys, so they are
 * normalized to keep "Front Door" and "front-door" from becoming two records.
 */
export function normalizeDeviceName(value: string): string {
  const trimmed = value.trim().toLowerCase().replace(/\s+/gu, "-");
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(trimmed)) {
    throw new TypeError(
      `"${value.trim()}" cannot be used as a device alias. It has to be typed identically into the project's block, so it is limited to letters, digits, dot, dash, and underscore, starting with a letter or digit — front-door, for example.`,
    );
  }
  return trimmed;
}

/**
 * Derives a usable alias from a device name the person chose in the sesame app.
 *
 * Those names are for people: they contain spaces, punctuation, and scripts
 * other than Latin. An alias has to survive being typed into a Scratch block,
 * so anything that will not fit is dropped, and a name that leaves nothing
 * behind falls back rather than failing. The alias is shown after pairing, so
 * a poor guess is visible and correctable rather than silent.
 */
export function suggestDeviceName(name: string | undefined): string {
  const slug = (name ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/gu, "-")
    .replace(/[^a-z0-9._-]/gu, "")
    .replace(/^[^a-z0-9]+/u, "")
    .slice(0, 64);
  return slug.length > 0 ? slug : "sesame";
}

function toPairedRecord(record: VaultRecord): PairedRecord {
  return {
    deviceName: record.deviceName,
    ...(record.uuid === undefined ? {} : { uuid: record.uuid }),
    ...(record.level === undefined ? {} : { level: record.level }),
    pairedAt: record.pairedAt,
  };
}

function hexToBytes(value: string): Uint8Array {
  return Uint8Array.from(value.match(/.{2}/gu) ?? [], (pair) =>
    Number.parseInt(pair, 16),
  );
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.slice().buffer as ArrayBuffer;
}
