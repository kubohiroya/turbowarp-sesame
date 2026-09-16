/**
 * The Bluetooth transport and its session state machine.
 *
 * ADR 0001 records why this exists and how custody of the device secret is
 * arranged. This module owns no key: it drives the GATT channel and asks the
 * keyholder to seal and open every frame.
 *
 * The session runs: connect, enable notifications, receive the four-byte random
 * code the device publishes, log in with the proof the keyholder derives, then
 * exchange sealed requests until closed.
 */

import type {
  DeviceStatus,
  SesameTransport,
  StatusListener,
  TransportCapability,
  Unsubscribe,
} from "../transport.js";
import type { SesameCommand } from "../sesame-client.js";
import { segmentPlaintext } from "./keyholder-session.js";
import type { GattChannel, KeyholderPort, KeyholderSession } from "./ports.js";
import {
  COMMAND_ITEM_CODES,
  decodeMechStatus,
  decodeMessage,
  encodeRequest,
  ItemCode,
  OpCode,
  ResultCode,
  toDeviceStatus,
  type MechStatus,
  type SesameMessage,
} from "./protocol.js";
import { SegmentAssembler, type SegmentMessage } from "./segment.js";

export interface BleTransportTimeouts {
  /** Waiting for the device to publish its session random code. */
  randomCode: number;
  /** Waiting for the login response. */
  login: number;
  /** Waiting for a command response. */
  command: number;
  /** Waiting for the first mechanical status when none has been pushed yet. */
  status: number;
}

const DEFAULT_TIMEOUTS: BleTransportTimeouts = {
  randomCode: 5_000,
  login: 5_000,
  command: 5_000,
  status: 3_000,
};

export interface BleTransportOptions {
  /**
   * The connected device. The caller opens it, because `requestDevice` needs
   * transient user activation and so must run from a click rather than from a
   * block evaluated in the VM's step loop.
   */
  channel: GattChannel;

  /** The origin holding the device secret. */
  keyholder: KeyholderPort;

  /**
   * Identifies which paired secret to use. Not a secret itself, in the same
   * way the broker's device alias is not.
   */
  deviceName: string;

  /** Overrides for the default timeouts. */
  timeouts?: Partial<BleTransportTimeouts>;

  now?: () => number;
}

/**
 * Longest history tag a SesameOS3 lock accepts.
 *
 * The published request table shows a seven-byte tag, but that is the length of
 * its worked example: the payload is length-prefixed and OS3 accepts up to
 * twenty-nine bytes, which the reference implementations agree on.
 */
export const MAX_HISTORY_TAG_BYTES = 29;

/**
 * A transport that speaks to the lock directly over Bluetooth LE.
 *
 * It differs from the cloud transports in both directions. It cannot paginate
 * history, so it omits `getHistory` and reports no `"history"` capability. It
 * can report genuine mechanical state as the device pushes it, so it provides
 * `onStatusChange` and reports `"statusEvents"`.
 */
export interface BleTransport extends SesameTransport {
  capabilities(): ReadonlySet<TransportCapability>;

  /**
   * Connects, enables notifications, waits for the four-byte random code the
   * device publishes, and logs in. Required before any other call.
   */
  connect(): Promise<void>;

  close(): Promise<void>;

  /** True once the login response has been accepted. */
  isLoggedIn(): boolean;
}

export const BLE_CAPABILITIES: ReadonlySet<TransportCapability> = new Set([
  "statusEvents",
]);

type State = "idle" | "connecting" | "ready" | "closed";

interface Waiter {
  matches(message: SesameMessage): boolean;
  settle(message: SesameMessage): void;
  fail(error: Error): void;
}

export class SesameBleTransport implements BleTransport {
  private state: State = "idle";
  private session: KeyholderSession | undefined;
  private unsubscribe: Unsubscribe | undefined;
  private readonly assembler = new SegmentAssembler();
  private readonly waiters = new Set<Waiter>();
  private readonly listeners = new Set<StatusListener>();
  private lastStatus: MechStatus | undefined;
  private readonly timeouts: BleTransportTimeouts;
  private readonly now: () => number;

  /**
   * Serializes frame handling. Each direction's CCM counter advances per frame,
   * so notifications must be opened in the order they arrived; decoding them
   * concurrently would pair frames with the wrong counters.
   */
  private decoding: Promise<void> = Promise.resolve();

  /** Serializes requests. The protocol expects one outstanding request. */
  private requests: Promise<unknown> = Promise.resolve();

  public constructor(private readonly options: BleTransportOptions) {
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...options.timeouts };
    this.now = options.now ?? Date.now;
  }

  public capabilities(): ReadonlySet<TransportCapability> {
    return BLE_CAPABILITIES;
  }

  public isLoggedIn(): boolean {
    return this.state === "ready";
  }

  public async connect(): Promise<void> {
    if (this.state === "ready") return;
    if (this.state !== "idle") {
      throw new Error(
        this.state === "closed"
          ? "This Sesame connection is closed. Open a new one."
          : "This Sesame connection is already being established.",
      );
    }
    this.state = "connecting";
    try {
      this.unsubscribe = this.options.channel.subscribe((packet) => {
        this.receive(packet);
      });

      // The device publishes its random code unprompted once notifications are
      // on, so the waiter must be armed before anything else happens.
      const initial = await this.expect(
        (message) =>
          message.type === OpCode.publish &&
          message.itemCode === ItemCode.initial,
        this.timeouts.randomCode,
        "The Sesame did not start a session. Move closer and try again.",
      );
      const randomCode = initial.payload.slice(0, 4);
      if (randomCode.length !== 4) {
        throw new Error("The Sesame sent a malformed session start.");
      }

      const { session, loginProof } = await this.options.keyholder.startSession(
        this.options.deviceName,
        randomCode,
      );
      this.session = session;

      // The login request travels in the clear: the session key is not proven
      // until the device accepts it.
      const response = this.expect(
        (message) =>
          message.type === OpCode.response &&
          message.itemCode === ItemCode.login,
        this.timeouts.login,
        "The Sesame did not answer the login request.",
      );
      await this.writeAll(
        segmentPlaintext(encodeRequest(ItemCode.login, loginProof)),
      );
      requireSuccess(await response, "log in to the Sesame");

      this.state = "ready";
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  public async getStatus(): Promise<DeviceStatus> {
    this.requireReady();
    if (this.lastStatus !== undefined) {
      return toDeviceStatus(this.lastStatus, this.now());
    }
    // Requesting status is documented as unanswered on some models, which push
    // it instead. Ask anyway, then wait for the push either way.
    const published = this.expect(
      (message) =>
        message.type === OpCode.publish &&
        message.itemCode === ItemCode.mechStatus,
      this.timeouts.status,
      "The Sesame did not report its state.",
    );
    await this.send(encodeRequest(ItemCode.mechStatus));
    await published;
    if (this.lastStatus === undefined) {
      throw new Error("The Sesame did not report its state.");
    }
    return toDeviceStatus(this.lastStatus, this.now());
  }

  public async sendCommand(
    command: SesameCommand,
    history: string,
  ): Promise<unknown> {
    this.requireReady();
    const resolved = await this.resolveCommand(command);
    const itemCode = COMMAND_ITEM_CODES[resolved];
    const response = this.expect(
      (message) =>
        message.type === OpCode.response && message.itemCode === itemCode,
      this.timeouts.command,
      `The Sesame did not answer the ${resolved} request.`,
    );
    await this.send(encodeRequest(itemCode, encodeHistoryTag(history)));
    requireSuccess(await response, `${resolved} the Sesame`);
    return { command: resolved };
  }

  public onStatusChange(listener: StatusListener): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public async close(): Promise<void> {
    if (this.state === "closed") return;
    this.state = "closed";
    this.failWaiters(new Error("The Sesame connection closed."));
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.assembler.reset();
    const session = this.session;
    this.session = undefined;
    this.listeners.clear();
    await session?.close();
    await this.options.channel.close();
  }

  /**
   * The Bluetooth protocol has no toggle item code, so it is resolved here from
   * the reported state.
   */
  private async resolveCommand(
    command: SesameCommand,
  ): Promise<"lock" | "unlock"> {
    if (command !== "toggle") return command;
    if (this.lastStatus === undefined) await this.getStatus();
    if (this.lastStatus === undefined) {
      throw new Error(
        "Cannot toggle without knowing whether the Sesame is locked.",
      );
    }
    return this.lastStatus.isInLockRange ? "unlock" : "lock";
  }

  private requireReady(): void {
    if (this.state !== "ready") {
      throw new Error("Connect to the Sesame first.");
    }
  }

  /** Seals a request and writes it, one request at a time. */
  private async send(message: Uint8Array): Promise<void> {
    const session = this.session;
    if (session === undefined) {
      throw new Error(
        this.state === "closed"
          ? "The Sesame connection closed."
          : "Connect to the Sesame first.",
      );
    }
    const run = this.requests.then(async () => {
      await this.writeAll(await session.seal(message));
    });
    // Keep the chain alive even when this request fails.
    this.requests = run.catch(() => undefined);
    await run;
  }

  private async writeAll(packets: readonly Uint8Array[]): Promise<void> {
    for (const packet of packets) {
      await this.options.channel.write(packet);
    }
  }

  /** Registers a one-shot waiter for the next message matching `matches`. */
  private expect(
    matches: (message: SesameMessage) => boolean,
    timeoutMs: number,
    timeoutMessage: string,
  ): Promise<SesameMessage> {
    return new Promise<SesameMessage>((resolve, reject) => {
      const waiter: Waiter = {
        matches,
        settle: (message) => {
          clearTimeout(timer);
          this.waiters.delete(waiter);
          resolve(message);
        },
        fail: (error) => {
          clearTimeout(timer);
          this.waiters.delete(waiter);
          reject(error);
        },
      };
      const timer = setTimeout(() => {
        waiter.fail(new Error(timeoutMessage));
      }, timeoutMs);
      this.waiters.add(waiter);
    });
  }

  private receive(packet: Uint8Array): void {
    let frame: SegmentMessage | undefined;
    try {
      frame = this.assembler.push(packet);
    } catch (error) {
      this.failWaiters(asError(error));
      return;
    }
    if (frame === undefined) return;
    const complete = frame;
    this.decoding = this.decoding
      .then(() => this.handleFrame(complete))
      .catch((error: unknown) => {
        this.failWaiters(asError(error));
      });
  }

  private async handleFrame(frame: SegmentMessage): Promise<void> {
    const session = this.session;
    let data: Uint8Array;
    if (session === undefined) {
      if (frame.parsing !== "plain") {
        throw new Error(
          "The Sesame sent an encrypted frame before the session started.",
        );
      }
      data = frame.data;
    } else {
      data = await session.open(frame.parsing, frame.data);
    }

    const message = decodeMessage(data);
    if (
      message.type === OpCode.publish &&
      message.itemCode === ItemCode.mechStatus
    ) {
      this.lastStatus = decodeMechStatus(message.payload);
      this.emit(toDeviceStatus(this.lastStatus, this.now()));
    }
    for (const waiter of this.waiters) {
      if (waiter.matches(message)) {
        waiter.settle(message);
        return;
      }
    }
  }

  private emit(status: DeviceStatus): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(status);
      } catch {
        // A listener that throws must not stop the others or the session.
      }
    }
  }

  private failWaiters(error: Error): void {
    for (const waiter of [...this.waiters]) waiter.fail(error);
  }
}

/**
 * Encodes the tag recorded in the device's own history list.
 *
 * The payload is the byte length followed by the UTF-8 bytes. Truncation
 * happens on a character boundary, so a multi-byte character is dropped whole
 * rather than cut in half.
 */
export function encodeHistoryTag(tag: string): Uint8Array {
  const encoded = new TextEncoder().encode(tag);
  let length = Math.min(encoded.length, MAX_HISTORY_TAG_BYTES);
  // Back off while the boundary lands inside a UTF-8 continuation sequence.
  while (length > 0 && ((encoded[length] ?? 0) & 0xc0) === 0x80) length -= 1;
  const payload = new Uint8Array(length + 1);
  payload[0] = length;
  payload.set(encoded.subarray(0, length), 1);
  return payload;
}

function requireSuccess(message: SesameMessage, action: string): void {
  if (message.result !== ResultCode.success) {
    throw new Error(
      `The Sesame refused to ${action} (result ${String(message.result)}).`,
    );
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
