import { describe, expect, it } from "vitest";
import { aesCmac, sesameTimestampMessage } from "../src/aes-cmac.js";

describe("AES-CMAC", () => {
  const key = "2b7e151628aed2a6abf7158809cf4f3c";

  it("matches the NIST empty-message vector", async () => {
    await expect(aesCmac(key, new Uint8Array())).resolves.toBe(
      "bb1d6929e95937287fa37d129b756746",
    );
  });

  it("matches the NIST complete-block vector", async () => {
    const message = Uint8Array.from(
      "6bc1bee22e409f96e93d7e117393172a".match(/.{2}/gu) ?? [],
      (pair) => Number.parseInt(pair, 16),
    );
    await expect(aesCmac(key, message)).resolves.toBe(
      "070a16b46b4d4144f79bdd9dd04a287c",
    );
  });
});

describe("Sesame timestamp message", () => {
  it("encodes uint32 little-endian and removes the first byte used by the API example", () => {
    expect(Array.from(sesameTimestampMessage(0x12345678))).toEqual([
      0x56, 0x34, 0x12,
    ]);
  });
});
