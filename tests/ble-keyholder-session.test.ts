import { describe, expect, it } from "vitest";
import { importCmacKey } from "../src/aes-cmac.js";
import { importCcmKey, open as ccmOpen } from "../src/ble/aes-ccm.js";
import {
  segmentPlaintext,
  startSession,
} from "../src/ble/keyholder-session.js";
import { ccmNonce, encodeRequest, ItemCode } from "../src/ble/protocol.js";
import { SegmentAssembler } from "../src/ble/segment.js";

const un = (value: string): Uint8Array =>
  Uint8Array.from(Buffer.from(value, "hex"));
const hex = (value: Uint8Array): string => Buffer.from(value).toString("hex");

const SECRET = un("2b7e151628aed2a6abf7158809cf4f3c");
const RANDOM_CODE = un("deadbeef");

const newSession = async () =>
  startSession(await importCmacKey(SECRET), RANDOM_CODE);

/**
 * The session token the device derives on its side, written out rather than
 * recomputed: `AES_CMAC(2b7e15..., deadbeef)`. AES-CMAC itself is checked
 * against the NIST vectors in aes-cmac.test.ts, so pinning the value here keeps
 * these tests about the session wiring.
 */
const deviceToken = (): Uint8Array => un("9a8e5155352c62495143b33d346f95a2");

describe("session establishment", () => {
  it("derives the login proof from the session token", async () => {
    const { loginProof } = await newSession();
    expect(loginProof).toHaveLength(4);
    // AES-CMAC(2b7e..., deadbeef) under the NIST test key.
    expect(hex(loginProof)).toBe(hex(deviceToken().slice(0, 4)));
  });

  it("rejects a random code that is not four bytes", async () => {
    await expect(
      startSession(await importCmacKey(SECRET), un("dead")),
    ).rejects.toThrow(/four bytes/u);
  });
});

describe("sealing requests", () => {
  it("produces packets the device can reassemble and decrypt", async () => {
    const { session } = await newSession();
    const request = encodeRequest(ItemCode.lock, un("0102030405"));

    const packets = await session.seal(request);

    // Device side: reassemble, then decrypt with its own copy of the token.
    const assembler = new SegmentAssembler();
    let frame;
    for (const packet of packets) frame = assembler.push(packet);
    expect(frame?.parsing).toBe("cipher");

    const deviceKey = await importCcmKey(deviceToken());
    const plaintext = await ccmOpen(
      {
        key: deviceKey,
        nonce: ccmNonce(0, RANDOM_CODE),
        additionalData: new Uint8Array([0]),
        tagLength: 4,
      },
      frame?.data ?? new Uint8Array(),
    );
    expect(hex(plaintext)).toBe(hex(request));
  });

  it("advances the counter so repeated requests differ", async () => {
    const { session } = await newSession();
    const request = encodeRequest(ItemCode.mechStatus);
    const first = await session.seal(request);
    const second = await session.seal(request);
    expect(hex(first[0] ?? new Uint8Array())).not.toBe(
      hex(second[0] ?? new Uint8Array()),
    );
  });

  it("splits a request longer than one packet", async () => {
    const { session } = await newSession();
    const packets = await session.seal(new Uint8Array(40));
    expect(packets.length).toBeGreaterThan(1);
    expect(packets[0]?.[0]).toBe(0x01);
    expect(packets[packets.length - 1]?.[0]).toBe(0x04);
  });
});

describe("opening responses", () => {
  const deviceSeal = async (
    plaintext: Uint8Array,
    count: number,
  ): Promise<Uint8Array> => {
    const { seal } = await import("../src/ble/aes-ccm.js");
    return seal(
      {
        key: await importCcmKey(deviceToken()),
        nonce: ccmNonce(count, RANDOM_CODE),
        additionalData: new Uint8Array([0]),
        tagLength: 4,
      },
      plaintext,
    );
  };

  it("returns a plaintext frame untouched, as the login response arrives", async () => {
    const { session } = await newSession();
    const response = un("070200aabbccdd");
    expect(hex(await session.open("plain", response))).toBe(hex(response));
  });

  it("decrypts an encrypted frame", async () => {
    const { session } = await newSession();
    const response = un("08510000000000000002");
    expect(
      hex(await session.open("cipher", await deviceSeal(response, 0))),
    ).toBe(hex(response));
  });

  it("tracks the receive counter separately from the send counter", async () => {
    const { session } = await newSession();
    await session.seal(encodeRequest(ItemCode.lock));
    await session.seal(encodeRequest(ItemCode.lock));
    // Sending twice must not advance the receive counter.
    const response = un("0752" + "00");
    expect(
      hex(await session.open("cipher", await deviceSeal(response, 0))),
    ).toBe(hex(response));
  });

  it("advances the receive counter across successive frames", async () => {
    const { session } = await newSession();
    await session.open("cipher", await deviceSeal(un("aa"), 0));
    expect(
      hex(await session.open("cipher", await deviceSeal(un("bb"), 1))),
    ).toBe("bb");
  });

  it("rejects a forged frame without advancing the counter", async () => {
    const { session } = await newSession();
    const forged = await deviceSeal(un("aa"), 0);
    forged[0] = (forged[0] ?? 0) ^ 0xff;
    await expect(session.open("cipher", forged)).rejects.toThrow(
      /tag mismatch/u,
    );
    // The session is still usable for the frame that was actually sent first.
    expect(
      hex(await session.open("cipher", await deviceSeal(un("aa"), 0))),
    ).toBe("aa");
  });

  it("rejects a frame sealed with a different session's random code", async () => {
    const { session } = await newSession();
    const other = await (
      await import("../src/ble/aes-ccm.js")
    ).seal(
      {
        key: await importCcmKey(deviceToken()),
        nonce: ccmNonce(0, un("00000000")),
        additionalData: new Uint8Array([0]),
        tagLength: 4,
      },
      un("aa"),
    );
    await expect(session.open("cipher", other)).rejects.toThrow(
      /tag mismatch/u,
    );
  });
});

describe("closing", () => {
  it("refuses to seal or open once closed", async () => {
    const { session } = await newSession();
    await session.close();
    await expect(session.seal(un("52"))).rejects.toThrow(/session is closed/u);
    await expect(session.open("cipher", un("00000000"))).rejects.toThrow(
      /session is closed/u,
    );
  });

  it("is safe to close twice", async () => {
    const { session } = await newSession();
    await session.close();
    await expect(session.close()).resolves.toBeUndefined();
  });
});

describe("plaintext segmentation", () => {
  it("marks the login request as a plaintext frame", () => {
    const packets = segmentPlaintext(
      encodeRequest(ItemCode.login, un("aabbccdd")),
    );
    expect(packets).toHaveLength(1);
    expect(Array.from(packets[0] ?? [])).toEqual([
      0x03, 0x02, 0xaa, 0xbb, 0xcc, 0xdd,
    ]);
  });
});
