import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decrypt,
  encrypt,
  importCcmKey,
  open,
  seal,
} from "../src/ble/aes-ccm.js";
import { ccmNonce } from "../src/ble/protocol.js";

const un = (value: string): Uint8Array =>
  Uint8Array.from(Buffer.from(value.replace(/\s/gu, ""), "hex"));
const hex = (value: Uint8Array): string => Buffer.from(value).toString("hex");

describe("AES-CCM published vectors", () => {
  it("matches NIST SP 800-38C example 1 (4-byte tag, 7-byte nonce)", async () => {
    const key = await importCcmKey(un("404142434445464748494a4b4c4d4e4f"));
    const { ciphertext, tag } = await encrypt(
      {
        key,
        nonce: un("10111213141516"),
        additionalData: un("0001020304050607"),
        tagLength: 4,
      },
      un("20212223"),
    );
    expect(hex(ciphertext)).toBe("7162015b");
    expect(hex(tag)).toBe("4dac255d");
  });

  it("matches RFC 3610 packet vector 1 (8-byte tag, 13-byte nonce)", async () => {
    const key = await importCcmKey(un("c0c1c2c3c4c5c6c7c8c9cacbcccdcecf"));
    const { ciphertext, tag } = await encrypt(
      {
        key,
        nonce: un("00000003020100a0a1a2a3a4a5"),
        additionalData: un("0001020304050607"),
        tagLength: 8,
      },
      un("08090a0b0c0d0e0f101112131415161718191a1b1c1d1e"),
    );
    expect(hex(ciphertext)).toBe(
      "588c979a61c663d2f066d0c2c0f989806d5f6b61dac384",
    );
    expect(hex(tag)).toBe("17e8d12cfdf926e0");
  });
});

describe("AES-CCM against the platform implementation", () => {
  const nativeSeal = (
    key: Buffer,
    nonce: Buffer,
    additionalData: Buffer,
    plaintext: Buffer,
    tagLength: number,
  ): string => {
    const cipher = crypto.createCipheriv("aes-128-ccm", key, nonce, {
      authTagLength: tagLength,
    });
    if (additionalData.length > 0) {
      cipher.setAAD(additionalData, { plaintextLength: plaintext.length });
    }
    const output = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return output.toString("hex") + cipher.getAuthTag().toString("hex");
  };

  // Every supported nonce length crossed with every supported tag length,
  // with and without additional data, across payloads that do and do not
  // land on a block boundary.
  it.each([7, 8, 9, 10, 11, 12, 13])(
    "agrees with node for a %i-byte nonce",
    async (nonceLength) => {
      for (const tagLength of [4, 6, 8, 10, 12, 14, 16]) {
        for (const plaintextLength of [0, 1, 15, 16, 17, 47]) {
          for (const additionalLength of [0, 1, 20]) {
            const rawKey = crypto.randomBytes(16);
            const nonce = crypto.randomBytes(nonceLength);
            const additionalData = crypto.randomBytes(additionalLength);
            const plaintext = crypto.randomBytes(plaintextLength);

            const parameters = {
              key: await importCcmKey(new Uint8Array(rawKey)),
              nonce: new Uint8Array(nonce),
              additionalData: new Uint8Array(additionalData),
              tagLength,
            };
            const sealed = await seal(parameters, new Uint8Array(plaintext));
            expect(hex(sealed)).toBe(
              nativeSeal(rawKey, nonce, additionalData, plaintext, tagLength),
            );
            expect(hex(await open(parameters, sealed))).toBe(
              plaintext.toString("hex"),
            );
          }
        }
      }
    },
  );
});

describe("AES-CCM authentication", () => {
  const parameters = async () => ({
    key: await importCcmKey(un("404142434445464748494a4b4c4d4e4f")),
    nonce: un("10111213141516"),
    additionalData: un("00"),
    tagLength: 4,
  });

  it("rejects a modified tag", async () => {
    const options = await parameters();
    const { ciphertext, tag } = await encrypt(options, un("cafebabe"));
    tag[0] = (tag[0] ?? 0) ^ 0x01;
    await expect(decrypt(options, ciphertext, tag)).rejects.toThrow(
      /tag mismatch/u,
    );
  });

  it("rejects a modified ciphertext", async () => {
    const options = await parameters();
    const { ciphertext, tag } = await encrypt(options, un("cafebabe"));
    ciphertext[0] = (ciphertext[0] ?? 0) ^ 0x01;
    await expect(decrypt(options, ciphertext, tag)).rejects.toThrow(
      /tag mismatch/u,
    );
  });

  it("rejects modified additional data", async () => {
    const options = await parameters();
    const sealed = await seal(options, un("cafebabe"));
    await expect(
      open({ ...options, additionalData: un("01") }, sealed),
    ).rejects.toThrow(/tag mismatch/u);
  });

  it("rejects a frame shorter than its tag", async () => {
    await expect(open(await parameters(), un("00"))).rejects.toThrow(
      /shorter than its authentication tag/u,
    );
  });
});

describe("AES-CCM parameter validation", () => {
  const key = async () => importCcmKey(un("404142434445464748494a4b4c4d4e4f"));

  it("rejects an out-of-range nonce", async () => {
    await expect(
      encrypt({ key: await key(), nonce: new Uint8Array(6) }, new Uint8Array()),
    ).rejects.toThrow(/7 to 13 bytes/u);
    await expect(
      encrypt(
        { key: await key(), nonce: new Uint8Array(14) },
        new Uint8Array(),
      ),
    ).rejects.toThrow(/7 to 13 bytes/u);
  });

  it("rejects an odd or out-of-range tag length", async () => {
    await expect(
      encrypt(
        { key: await key(), nonce: new Uint8Array(13), tagLength: 5 },
        new Uint8Array(),
      ),
    ).rejects.toThrow(/even number of bytes/u);
  });

  it("rejects a payload too long for the length field", async () => {
    // A 13-byte nonce leaves a two-byte length field, so 65536 bytes overflow.
    await expect(
      encrypt(
        { key: await key(), nonce: new Uint8Array(13) },
        new Uint8Array(65_536),
      ),
    ).rejects.toThrow(/does not fit/u);
  });
});

describe("SesameOS3 initialization vector", () => {
  it("packs the counter little-endian, one unused byte, then the random code", () => {
    expect(hex(ccmNonce(1, un("aabbccdd")))).toBe(
      "0100000000000000" + "00" + "aabbccdd",
    );
  });

  it("carries counters beyond the 32-bit range", () => {
    expect(hex(ccmNonce(0x0102030405n, un("00000000")))).toBe(
      "0504030201000000" + "00" + "00000000",
    );
  });

  it("produces a nonce AES-CCM accepts", async () => {
    const key = await importCcmKey(un("404142434445464748494a4b4c4d4e4f"));
    const nonce = ccmNonce(7, un("deadbeef"));
    expect(nonce).toHaveLength(13);
    const parameters = { key, nonce, additionalData: un("00"), tagLength: 4 };
    const sealed = await seal(parameters, un("520102"));
    expect(hex(await open(parameters, sealed))).toBe("520102");
  });

  it("rejects a random code that is not four bytes", () => {
    expect(() => ccmNonce(0, un("aabb"))).toThrow(/four bytes/u);
  });
});
