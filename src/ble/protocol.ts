/**
 * SesameOS3 application layer: identifiers, message framing, and the decoding
 * of mechanical status into the field vocabulary used by the Candy House Web
 * API.
 *
 * Source: CANDY HOUSE's published Bluetooth API documentation (MIT).
 * https://github.com/CANDY-HOUSE/Sesame_BluetoothAPI_document
 */

import type { DeviceStatus } from "../transport.js";

/** BLE service registered by CANDY HOUSE with the Bluetooth SIG. */
export const SERVICE_UUID = 0xfd81;

/** Written without response to send requests. */
export const TX_CHARACTERISTIC_UUID = "16860002-a5ae-9856-b6d3-dbb4c676993e";

/** Notified to deliver responses and publishes. */
export const RX_CHARACTERISTIC_UUID = "16860003-a5ae-9856-b6d3-dbb4c676993e";

/** Manufacturer identifier in the advertisement. */
export const COMPANY_ID = 0x055a;

export const ItemCode = {
  registration: 1,
  login: 2,
  history: 4,
  versionDetail: 5,
  time: 8,
  autolock: 11,
  initial: 14,
  magnet: 17,
  mechSetting: 80,
  mechStatus: 81,
  lock: 82,
  unlock: 83,
  reset: 104,
} as const;

export type ItemCodeName = keyof typeof ItemCode;

export const OpCode = {
  /** Acknowledgement of a request. */
  response: 0x07,
  /** Unsolicited message from the device. */
  publish: 0x08,
} as const;

export const ResultCode = {
  success: 0x00,
  invalidAction: 0x09,
} as const;

/**
 * The Bluetooth protocol has no toggle item code; the Web API's `toggle` (88)
 * has no counterpart here. A Bluetooth transport implements it by reading
 * {@link MechStatus.isInLockRange} and sending lock or unlock accordingly.
 */
export const COMMAND_ITEM_CODES = {
  lock: ItemCode.lock,
  unlock: ItemCode.unlock,
} as const;

export interface SesameMessage {
  /** {@link OpCode.response} or {@link OpCode.publish}. */
  type: number;
  itemCode: number;
  /** Command result. Present on responses, absent on publishes. */
  result?: number;
  payload: Uint8Array;
}

/**
 * Builds a request body for the security layer: an item code followed by its
 * payload. The segment layer adds the packet header afterwards.
 */
export function encodeRequest(
  itemCode: number,
  payload: Uint8Array = new Uint8Array(),
): Uint8Array {
  const message = new Uint8Array(payload.length + 1);
  message[0] = itemCode;
  message.set(payload, 1);
  return message;
}

/**
 * Parses a reassembled message from the device.
 *
 * A response carries `type, item_code, result, payload...`; a publish carries
 * `type, item_code, payload...` with no result byte.
 */
export function decodeMessage(data: Uint8Array): SesameMessage {
  const type = data[0];
  const itemCode = data[1];
  if (type === undefined || itemCode === undefined) {
    throw new Error("Sesame BLE message is shorter than its header.");
  }
  if (type === OpCode.publish) {
    return { type, itemCode, payload: data.slice(2) };
  }
  if (type !== OpCode.response) {
    throw new Error(`Unknown Sesame BLE message type: ${type}.`);
  }
  const result = data[2];
  if (result === undefined) {
    throw new Error("Sesame BLE response is missing its result byte.");
  }
  return { type, itemCode, result, payload: data.slice(3) };
}

/**
 * Builds the 13-byte AES-CCM initialization vector of the security layer.
 *
 * The documented layout is a packed struct on a little-endian device:
 * `int64_t count`, one unused zero byte, then the four-byte session random
 * code. The counter advances by one per operation and is tracked separately
 * for each direction, so a frame sent and a frame received never share an IV.
 */
export function ccmNonce(
  count: number | bigint,
  randomCode: Uint8Array,
): Uint8Array {
  if (randomCode.length !== 4) {
    throw new TypeError("Sesame session random code must be four bytes.");
  }
  const nonce = new Uint8Array(13);
  new DataView(nonce.buffer).setBigInt64(0, BigInt(count), true);
  nonce.set(randomCode, 9);
  return nonce;
}

export interface MechStatus {
  /** Raw battery reading. See {@link batteryVoltage}. */
  battery: number;
  /** Angle the motor is driving towards. */
  target: number;
  /** Most recent angle reported by the sensor. */
  position: number;
  isClutchFailed: boolean;
  isInLockRange: boolean;
  isInUnlockRange: boolean;
  /** A lock or unlock operation timed out and the motor stopped. */
  isCritical: boolean;
  isStop: boolean;
  isLowBattery: boolean;
  isClockwise: boolean;
}

/**
 * Decodes the seven-byte mechanical status payload of item code 81.
 *
 * Layout: `battery` uint16, `target` int16, `position` int16, all little
 * endian, then one byte of flags.
 */
export function decodeMechStatus(payload: Uint8Array): MechStatus {
  if (payload.length < 7) {
    throw new Error(
      `Sesame mechanical status needs seven bytes, received ${payload.length}.`,
    );
  }
  const view = new DataView(
    payload.buffer,
    payload.byteOffset,
    payload.byteLength,
  );
  const flags = view.getUint8(6);
  return {
    battery: view.getUint16(0, true),
    target: view.getInt16(2, true),
    position: view.getInt16(4, true),
    isClutchFailed: (flags & 0x01) !== 0,
    isInLockRange: (flags & 0x02) !== 0,
    isInUnlockRange: (flags & 0x04) !== 0,
    isCritical: (flags & 0x08) !== 0,
    isStop: (flags & 0x10) !== 0,
    isLowBattery: (flags & 0x20) !== 0,
    isClockwise: (flags & 0x40) !== 0,
  };
}

/**
 * Converts the raw battery reading of a SesameOS3 lock into volts.
 *
 * SesameOS3 reports millivolts per cell and these locks use two cells in
 * series, so the reading is scaled by two.
 */
export function batteryVoltage(battery: number): number {
  return (battery * 2) / 1000;
}

/**
 * Voltage to remaining percentage, linearly interpolated between the reference
 * points published for these locks.
 */
const BATTERY_TABLE: ReadonlyArray<readonly [number, number]> = [
  [5.85, 100],
  [5.82, 95],
  [5.79, 90],
  [5.76, 85],
  [5.73, 80],
  [5.7, 70],
  [5.65, 60],
  [5.6, 50],
  [5.55, 40],
  [5.5, 32],
  [5.4, 21],
  [5.2, 13],
  [5.1, 10],
  [5.0, 7],
  [4.8, 3],
  [4.6, 0],
];

export function batteryPercentage(voltage: number): number {
  const first = BATTERY_TABLE[0];
  const last = BATTERY_TABLE[BATTERY_TABLE.length - 1];
  if (first === undefined || last === undefined) return 0;
  if (voltage >= first[0]) return first[1];
  if (voltage <= last[0]) return last[1];

  for (let index = 1; index < BATTERY_TABLE.length; index += 1) {
    const lower = BATTERY_TABLE[index];
    const upper = BATTERY_TABLE[index - 1];
    if (lower === undefined || upper === undefined) break;
    if (voltage >= lower[0]) {
      const ratio = (voltage - lower[0]) / (upper[0] - lower[0]);
      return ratio * (upper[1] - lower[1]) + lower[1];
    }
  }
  return last[1];
}

/**
 * Projects mechanical status into the field names the Web API returns, so that
 * the status block reads the same fields over Bluetooth as over the cloud.
 *
 * `wm2State` is deliberately absent: it describes a WiFi Module 2, which is
 * not involved in a Bluetooth session. Callers reading that field receive the
 * empty value rather than a fabricated one.
 */
export function toDeviceStatus(
  status: MechStatus,
  now: number = Date.now(),
): DeviceStatus {
  const voltage = batteryVoltage(status.battery);
  return {
    CHSesame2Status: lockState(status),
    batteryPercentage: batteryPercentage(voltage),
    batteryVoltage: voltage,
    position: status.position,
    timestamp: Math.floor(now / 1000),
  };
}

function lockState(status: MechStatus): string {
  if (status.isInLockRange) return "locked";
  if (status.isInUnlockRange) return "unlocked";
  return "moved";
}
