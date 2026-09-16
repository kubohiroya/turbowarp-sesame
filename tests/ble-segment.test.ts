import { describe, expect, it } from "vitest";
import {
  encodeSegments,
  SegmentAssembler,
  type SegmentMessage,
} from "../src/ble/segment.js";

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);
const headers = (packets: Uint8Array[]): number[] =>
  packets.map((packet) => packet[0] ?? -1);

describe("segment layer encoding", () => {
  // The protocol documentation works its examples with a four-byte packet,
  // which is a five-byte packet once the header is counted.
  const packetSize = 5;

  it("marks a short plaintext message as both start and end", () => {
    const packets = encodeSegments(
      { parsing: "plain", data: bytes(0xaa, 0xaa, 0xbb, 0xbb) },
      packetSize,
    );
    expect(packets).toHaveLength(1);
    expect(Array.from(packets[0] ?? [])).toEqual([
      0x03, 0xaa, 0xaa, 0xbb, 0xbb,
    ]);
  });

  it("marks a two-packet plaintext message as start then plaintext end", () => {
    const packets = encodeSegments(
      { parsing: "plain", data: bytes(1, 2, 3, 4, 5, 6, 7, 8) },
      packetSize,
    );
    expect(headers(packets)).toEqual([0x01, 0x02]);
  });

  it("marks the middle packet of a three-packet message as neither", () => {
    const packets = encodeSegments(
      { parsing: "plain", data: bytes(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12) },
      packetSize,
    );
    expect(headers(packets)).toEqual([0x01, 0x00, 0x02]);
  });

  it("uses the ciphertext end marker for encrypted messages", () => {
    expect(
      headers(
        encodeSegments({ parsing: "cipher", data: bytes(1) }, packetSize),
      ),
    ).toEqual([0x05]);
    expect(
      headers(
        encodeSegments(
          { parsing: "cipher", data: bytes(1, 2, 3, 4, 5, 6, 7, 8) },
          packetSize,
        ),
      ),
    ).toEqual([0x01, 0x04]);
  });

  it("still emits a terminating packet for an empty message", () => {
    const packets = encodeSegments({ parsing: "plain", data: bytes() });
    expect(packets).toHaveLength(1);
    expect(Array.from(packets[0] ?? [])).toEqual([0x03]);
  });

  it("splits at twenty bytes by default, header included", () => {
    const packets = encodeSegments({
      parsing: "plain",
      data: new Uint8Array(19),
    });
    expect(packets).toHaveLength(1);
    expect(packets[0]).toHaveLength(20);
  });

  it("rejects a packet size with no room for payload", () => {
    expect(() =>
      encodeSegments({ parsing: "plain", data: bytes(1) }, 1),
    ).toThrow(TypeError);
  });
});

describe("segment layer reassembly", () => {
  const roundTrip = (message: SegmentMessage, packetSize?: number) => {
    const assembler = new SegmentAssembler();
    let result: SegmentMessage | undefined;
    for (const packet of encodeSegments(message, packetSize)) {
      result = assembler.push(packet);
    }
    return result;
  };

  it("round-trips a message that fits in one packet", () => {
    expect(roundTrip({ parsing: "plain", data: bytes(1, 2, 3) })).toEqual({
      parsing: "plain",
      data: bytes(1, 2, 3),
    });
  });

  it("round-trips a message spanning three packets", () => {
    const data = Uint8Array.from({ length: 12 }, (_, index) => index);
    expect(roundTrip({ parsing: "cipher", data }, 5)).toEqual({
      parsing: "cipher",
      data,
    });
  });

  it("returns nothing until the final packet arrives", () => {
    const assembler = new SegmentAssembler();
    const packets = encodeSegments(
      { parsing: "plain", data: bytes(1, 2, 3, 4, 5, 6, 7, 8) },
      5,
    );
    expect(assembler.push(packets[0] ?? bytes())).toBeUndefined();
    expect(assembler.push(packets[1] ?? bytes())).toBeDefined();
  });

  it("ignores a continuation that arrives without its start packet", () => {
    const assembler = new SegmentAssembler();
    expect(assembler.push(bytes(0x02, 0x99))).toBeUndefined();
  });

  it("discards a truncated message when the next one starts", () => {
    const assembler = new SegmentAssembler();
    assembler.push(bytes(0x01, 0xde, 0xad));
    expect(assembler.push(bytes(0x03, 0x42))).toEqual({
      parsing: "plain",
      data: bytes(0x42),
    });
  });

  it("rejects an empty packet", () => {
    expect(() => new SegmentAssembler().push(bytes())).toThrow(
      /empty Sesame BLE packet/u,
    );
  });
});
