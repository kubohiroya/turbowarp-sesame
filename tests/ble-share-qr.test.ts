import { describe, expect, it } from "vitest";
import { KeyLevel, parseShareQr, redact } from "../src/ble/share-qr.js";

/** Builds a share URL the way the sesame app does, for a chosen model. */
const shareUrl = (
  model: number,
  options: { level?: number; name?: string; truncate?: number } = {},
): string => {
  const publicKeyBytes = model >= 5 ? 4 : 64;
  const record = new Uint8Array(1 + 16 + publicKeyBytes + 2 + 16);
  record[0] = model;
  record.fill(0xab, 1, 17); // secret
  record.fill(0xcd, 17, 17 + publicKeyBytes); // public key
  record.fill(0x00, 17 + publicKeyBytes, 19 + publicKeyBytes); // key index
  record.set(
    Uint8Array.from({ length: 16 }, (_, index) => index),
    19 + publicKeyBytes,
  );
  const sliced =
    options.truncate === undefined ? record : record.slice(0, options.truncate);
  const base64 = Buffer.from(sliced).toString("base64");

  const query = new URLSearchParams({ t: "sk", sk: base64 });
  if (options.level !== undefined) query.set("l", String(options.level));
  if (options.name !== undefined) query.set("n", options.name);
  return `ssm://UI?${query.toString()}`;
};

describe("share QR parsing", () => {
  it("reads a SESAME 5 record, which carries a four-byte public key", () => {
    const key = parseShareQr(shareUrl(5, { level: 0, name: "front door" }));
    expect(key).toEqual({
      model: 5,
      secret: "ab".repeat(16),
      publicKey: "cdcdcdcd",
      keyIndex: "0000",
      uuid: "00010203-0405-0607-0809-0A0B0C0D0E0F",
      level: "owner",
      name: "front door",
    });
  });

  it("reads a SESAME 4 record, which carries a sixty-four-byte public key", () => {
    const key = parseShareQr(shareUrl(4));
    expect(key.model).toBe(4);
    expect(key.publicKey).toHaveLength(128);
    expect(key.secret).toBe("ab".repeat(16));
    expect(key.uuid).toBe("00010203-0405-0607-0809-0A0B0C0D0E0F");
  });

  it("treats SESAME 5 Pro like SESAME 5", () => {
    expect(parseShareQr(shareUrl(7)).publicKey).toHaveLength(8);
  });

  it("names each advisory key level", () => {
    expect(parseShareQr(shareUrl(5, { level: KeyLevel.owner })).level).toBe(
      "owner",
    );
    expect(parseShareQr(shareUrl(5, { level: KeyLevel.manager })).level).toBe(
      "manager",
    );
    expect(parseShareQr(shareUrl(5, { level: KeyLevel.guest })).level).toBe(
      "guest",
    );
  });

  it("omits the level rather than guessing when it is absent or unknown", () => {
    expect(parseShareQr(shareUrl(5)).level).toBeUndefined();
    expect(parseShareQr(shareUrl(5, { level: 9 })).level).toBeUndefined();
  });

  it("omits an empty device name", () => {
    expect(parseShareQr(shareUrl(5, { name: "" })).name).toBeUndefined();
  });
});

describe("share QR rejection", () => {
  it("rejects a code that is not a sesame URL", () => {
    expect(() => parseShareQr("https://example.com/")).toThrow(
      /not a sesame sharing QR code/u,
    );
  });

  it("rejects a sesame code that shares something other than a key", () => {
    expect(() => parseShareQr("ssm://UI?t=friend&friend=abc")).toThrow(
      /does not share a key/u,
    );
  });

  it("rejects a key code with no payload", () => {
    expect(() => parseShareQr("ssm://UI?t=sk&sk=")).toThrow(/carries no key/u);
  });

  it("rejects a payload that is not base64", () => {
    expect(() => parseShareQr("ssm://UI?t=sk&sk=!!!!")).toThrow(
      /not valid base64/u,
    );
  });

  it("rejects a record whose length disagrees with its model", () => {
    expect(() => parseShareQr(shareUrl(5, { truncate: 20 }))).toThrow(
      /20 bytes, but model 5 needs 39/u,
    );
    // A SESAME 4 record presented as SESAME 5 is the same kind of mismatch.
    expect(() => parseShareQr(shareUrl(4, { truncate: 39 }))).toThrow(
      /needs 99/u,
    );
  });
});

describe("redaction", () => {
  it("removes the secret while keeping the identifying fields", () => {
    const key = parseShareQr(shareUrl(5, { name: "front door" }));
    const safe = redact(key);
    expect(safe.secret).toBe("[redacted]");
    expect(safe.uuid).toBe(key.uuid);
    expect(safe.name).toBe("front door");
    expect(JSON.stringify(safe)).not.toContain("abab");
  });
});
