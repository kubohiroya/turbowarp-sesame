import { describe, expect, it } from "vitest";
import {
  batteryPercentage,
  batteryVoltage,
  COMMAND_ITEM_CODES,
  decodeMechStatus,
  decodeMessage,
  encodeRequest,
  ItemCode,
  OpCode,
  toDeviceStatus,
} from "../src/ble/protocol.js";

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);

/** Battery 0x0B4A (2890) -> 5.78 V, target and position both 0x0000. */
const statusPayload = (flags: number): Uint8Array =>
  bytes(0x4a, 0x0b, 0x00, 0x00, 0x00, 0x00, flags);

describe("request encoding", () => {
  it("places the item code ahead of the payload", () => {
    expect(Array.from(encodeRequest(ItemCode.lock, bytes(1, 2, 3)))).toEqual([
      82, 1, 2, 3,
    ]);
  });

  it("encodes a payload-free request as a single byte", () => {
    expect(Array.from(encodeRequest(ItemCode.mechStatus))).toEqual([81]);
  });

  it("has no toggle item code, unlike the Web API", () => {
    expect(Object.keys(COMMAND_ITEM_CODES)).toEqual(["lock", "unlock"]);
  });
});

describe("message decoding", () => {
  it("reads the result byte of a response", () => {
    expect(decodeMessage(bytes(0x07, 82, 0x00, 0xaa))).toEqual({
      type: OpCode.response,
      itemCode: ItemCode.lock,
      result: 0x00,
      payload: bytes(0xaa),
    });
  });

  it("treats a publish as having no result byte", () => {
    expect(decodeMessage(bytes(0x08, 14, 0x01, 0x02, 0x03, 0x04))).toEqual({
      type: OpCode.publish,
      itemCode: ItemCode.initial,
      payload: bytes(0x01, 0x02, 0x03, 0x04),
    });
  });

  it("rejects a message shorter than its header", () => {
    expect(() => decodeMessage(bytes(0x07))).toThrow(
      /shorter than its header/u,
    );
  });

  it("rejects a response with no result byte", () => {
    expect(() => decodeMessage(bytes(0x07, 82))).toThrow(/missing its result/u);
  });

  it("rejects an unknown message type", () => {
    expect(() => decodeMessage(bytes(0x01, 82, 0x00))).toThrow(/Unknown/u);
  });
});

describe("mechanical status decoding", () => {
  it("reads the little-endian fields", () => {
    const status = decodeMechStatus(
      bytes(0x4a, 0x0b, 0xd0, 0x07, 0x30, 0xf8, 0x00),
    );
    expect(status.battery).toBe(2890);
    expect(status.target).toBe(2000);
    expect(status.position).toBe(-2000);
  });

  it("maps each flag to its documented bit", () => {
    expect(decodeMechStatus(statusPayload(0b0000_0010)).isInLockRange).toBe(
      true,
    );
    expect(decodeMechStatus(statusPayload(0b0000_0100)).isInUnlockRange).toBe(
      true,
    );
    expect(decodeMechStatus(statusPayload(0b0010_0000)).isLowBattery).toBe(
      true,
    );
    expect(decodeMechStatus(statusPayload(0b0100_0000)).isClockwise).toBe(true);
    expect(decodeMechStatus(statusPayload(0b0000_0000)).isInLockRange).toBe(
      false,
    );
  });

  it("decodes correctly when the payload is a view into a larger buffer", () => {
    const frame = bytes(0x08, 81, 0x4a, 0x0b, 0x00, 0x00, 0x00, 0x00, 0x02);
    const { payload } = decodeMessage(frame);
    expect(decodeMechStatus(payload).isInLockRange).toBe(true);
  });

  it("rejects a truncated payload", () => {
    expect(() => decodeMechStatus(bytes(1, 2, 3))).toThrow(/seven bytes/u);
  });
});

describe("battery conversion", () => {
  it("scales the raw reading by two cells in millivolts", () => {
    expect(batteryVoltage(2890)).toBeCloseTo(5.78, 5);
  });

  it("clamps outside the reference table", () => {
    expect(batteryPercentage(6.0)).toBe(100);
    expect(batteryPercentage(4.0)).toBe(0);
  });

  it("returns reference points exactly", () => {
    expect(batteryPercentage(5.6)).toBeCloseTo(50, 5);
    expect(batteryPercentage(5.2)).toBeCloseTo(13, 5);
  });

  it("interpolates between reference points", () => {
    // Midway between 5.60 V (50%) and 5.65 V (60%).
    expect(batteryPercentage(5.625)).toBeCloseTo(55, 3);
  });
});

describe("projection into Web API field names", () => {
  const status = decodeMechStatus(statusPayload(0b0000_0010));

  it("reports the lock state under CHSesame2Status", () => {
    expect(toDeviceStatus(status).CHSesame2Status).toBe("locked");
    expect(
      toDeviceStatus(decodeMechStatus(statusPayload(0b0000_0100)))
        .CHSesame2Status,
    ).toBe("unlocked");
    expect(
      toDeviceStatus(decodeMechStatus(statusPayload(0b0000_0000)))
        .CHSesame2Status,
    ).toBe("moved");
  });

  it("supplies every status field except the WiFi module state", () => {
    const record = toDeviceStatus(status, 1_700_000_000_000);
    expect(Object.keys(record).sort()).toEqual([
      "CHSesame2Status",
      "batteryPercentage",
      "batteryVoltage",
      "position",
      "timestamp",
    ]);
    expect(record.wm2State).toBeUndefined();
    expect(record.timestamp).toBe(1_700_000_000);
  });
});
