/**
 * SesameOS3 segment layer.
 *
 * The segment layer does two things: it splits a message across the 20-byte
 * BLE packet limit and reassembles it, and it marks whether the reassembled
 * message is plaintext or ciphertext. Each packet carries a one-byte header
 * whose bit 0 marks the first packet of a message and whose remaining bits
 * mark the last packet and its parsing type.
 *
 * Header values, from the protocol documentation:
 *
 * | Value | Start | End              |
 * | ----- | ----- | ---------------- |
 * | 0x00  | no    | no               |
 * | 0x01  | yes   | no               |
 * | 0x02  | no    | yes, plaintext   |
 * | 0x03  | yes   | yes, plaintext   |
 * | 0x04  | no    | yes, ciphertext  |
 * | 0x05  | yes   | yes, ciphertext  |
 */

/** Maximum bytes per BLE packet, header included. */
export const PACKET_SIZE = 20;

const PAYLOAD_SIZE = PACKET_SIZE - 1;

const START_BIT = 0x01;
const END_PLAIN = 0x02;
const END_CIPHER = 0x04;

export type ParsingType = "plain" | "cipher";

export interface SegmentMessage {
  parsing: ParsingType;
  data: Uint8Array;
}

/**
 * Splits a message into BLE packets. An empty message still produces one
 * packet, because the receiver needs a terminating header to reassemble it.
 */
export function encodeSegments(
  message: SegmentMessage,
  packetSize: number = PACKET_SIZE,
): Uint8Array[] {
  const payloadSize = requirePayloadSize(packetSize);
  const end = message.parsing === "cipher" ? END_CIPHER : END_PLAIN;
  const packets: Uint8Array[] = [];
  const total = Math.max(1, Math.ceil(message.data.length / payloadSize));

  for (let index = 0; index < total; index += 1) {
    const chunk = message.data.subarray(
      index * payloadSize,
      (index + 1) * payloadSize,
    );
    const header =
      (index === 0 ? START_BIT : 0) | (index === total - 1 ? end : 0);
    const packet = new Uint8Array(chunk.length + 1);
    packet[0] = header;
    packet.set(chunk, 1);
    packets.push(packet);
  }
  return packets;
}

/**
 * Reassembles BLE packets into messages.
 *
 * Notifications arrive one packet at a time, so callers feed packets in as they
 * are received and act on whatever {@link push} returns. The buffer is reset on
 * a start packet, which recovers from a message truncated by a dropped
 * notification rather than silently prefixing the next one.
 */
export class SegmentAssembler {
  private buffer: number[] = [];
  private started = false;

  /** Returns the message once its final packet arrives, otherwise undefined. */
  public push(packet: Uint8Array): SegmentMessage | undefined {
    const header = packet[0];
    if (header === undefined) {
      throw new Error("Received an empty Sesame BLE packet.");
    }
    if ((header & START_BIT) !== 0) {
      this.buffer = [];
      this.started = true;
    } else if (!this.started) {
      // A continuation without its start packet cannot be reassembled.
      return undefined;
    }
    this.buffer.push(...packet.subarray(1));

    const parsing = endParsingType(header);
    if (parsing === undefined) return undefined;

    const data = Uint8Array.from(this.buffer);
    this.reset();
    return { parsing, data };
  }

  public reset(): void {
    this.buffer = [];
    this.started = false;
  }
}

function endParsingType(header: number): ParsingType | undefined {
  if ((header & END_CIPHER) !== 0) return "cipher";
  if ((header & END_PLAIN) !== 0) return "plain";
  return undefined;
}

function requirePayloadSize(packetSize: number): number {
  if (!Number.isInteger(packetSize) || packetSize < 2) {
    throw new TypeError("Sesame BLE packet size must be an integer above one.");
  }
  return packetSize - 1;
}

export { PAYLOAD_SIZE };
