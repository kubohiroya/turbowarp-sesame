/**
 * A Sesame device standing in for the real one.
 *
 * It implements the device half of the protocol with its own copy of the
 * secret: it publishes a random code, checks the login proof, decrypts requests
 * with its own counters, and answers. Driving the transport against it exercises
 * the real framing, sealing, and counter handling rather than a mock of them.
 */

import { importCmacKey, aesCmacWithKey } from "../../src/aes-cmac.js";
import {
  importCcmKey,
  open,
  seal,
  type CcmKey,
} from "../../src/ble/aes-ccm.js";
import type {
  GattChannel,
  KeyholderPort,
  SessionStart,
} from "../../src/ble/ports.js";
import { startSession } from "../../src/ble/keyholder-session.js";
import { ccmNonce, OpCode } from "../../src/ble/protocol.js";
import {
  encodeSegments,
  SegmentAssembler,
  type ParsingType,
} from "../../src/ble/segment.js";

const ADDITIONAL_DATA = new Uint8Array([0]);
const TAG_LENGTH = 4;

export interface DeviceRequest {
  itemCode: number;
  payload: Uint8Array;
}

export class FakeSesame implements GattChannel {
  public readonly requests: DeviceRequest[] = [];
  public loggedIn = false;
  public closed = false;
  /** Set to stop answering, to exercise timeouts. */
  public silent = false;

  private listener: ((packet: Uint8Array) => void) | undefined;
  private readonly assembler = new SegmentAssembler();
  private sessionKey: CcmKey | undefined;
  private expectedProof: Uint8Array | undefined;
  private sentCount = 0;
  private receivedCount = 0;
  private chain: Promise<void> = Promise.resolve();

  public constructor(
    private readonly secret: Uint8Array,
    private readonly randomCode: Uint8Array,
  ) {}

  /** Answers requests automatically. Override to script specific replies. */
  public onRequest: (request: DeviceRequest) => Uint8Array[] = (request) => [
    Uint8Array.from([OpCode.response, request.itemCode, 0x00]),
  ];

  public subscribe(listener: (packet: Uint8Array) => void): () => void {
    this.listener = listener;
    // The device publishes its random code as soon as notifications are on.
    queueMicrotask(() => {
      this.publishPlain(
        Uint8Array.from([OpCode.publish, 14, ...this.randomCode]),
      );
    });
    return () => {
      this.listener = undefined;
    };
  }

  public write(packet: Uint8Array): Promise<void> {
    const frame = this.assembler.push(packet);
    if (frame !== undefined) {
      this.chain = this.chain.then(() => this.handle(frame));
    }
    return Promise.resolve();
  }

  public close(): Promise<void> {
    this.closed = true;
    this.listener = undefined;
    return Promise.resolve();
  }

  /** Pushes a mechanical status the way the device does when state changes. */
  public async publishStatus(payload: Uint8Array): Promise<void> {
    await this.publishSealed(Uint8Array.from([OpCode.publish, 81, ...payload]));
  }

  /** Waits for every queued request to be handled. */
  public async settle(): Promise<void> {
    await this.chain;
  }

  private async handle(frame: {
    parsing: ParsingType;
    data: Uint8Array;
  }): Promise<void> {
    let data = frame.data;
    if (frame.parsing === "cipher") {
      const key = this.sessionKey;
      if (key === undefined) throw new Error("device: no session yet");
      data = await open(
        {
          key,
          nonce: ccmNonce(this.receivedCount, this.randomCode),
          additionalData: ADDITIONAL_DATA,
          tagLength: TAG_LENGTH,
        },
        data,
      );
      this.receivedCount += 1;
    }
    const itemCode = data[0] ?? 0;
    const payload = data.slice(1);
    this.requests.push({ itemCode, payload });
    if (this.silent) return;

    if (itemCode === 2) {
      await this.establish(payload);
      return;
    }
    for (const response of this.onRequest({ itemCode, payload })) {
      await this.publishSealed(response);
    }
  }

  private async establish(proof: Uint8Array): Promise<void> {
    const token = await aesCmacWithKey(
      await importCmacKey(this.secret),
      this.randomCode,
    );
    this.expectedProof = token.slice(0, 4);
    const matches =
      proof.length >= 4 &&
      this.expectedProof.every((byte, index) => byte === proof[index]);
    this.sessionKey = await importCcmKey(token);
    this.loggedIn = matches;
    // Login is answered in the clear, before the session is in force.
    this.publishPlain(
      Uint8Array.from([OpCode.response, 2, matches ? 0x00 : 0x09, 0, 0, 0, 0]),
    );
  }

  private publishPlain(message: Uint8Array): void {
    this.deliver(encodeSegments({ parsing: "plain", data: message }));
  }

  private async publishSealed(message: Uint8Array): Promise<void> {
    const key = this.sessionKey;
    if (key === undefined) throw new Error("device: no session yet");
    const sealed = await seal(
      {
        key,
        nonce: ccmNonce(this.sentCount, this.randomCode),
        additionalData: ADDITIONAL_DATA,
        tagLength: TAG_LENGTH,
      },
      message,
    );
    this.sentCount += 1;
    this.deliver(encodeSegments({ parsing: "cipher", data: sealed }));
  }

  private deliver(packets: Uint8Array[]): void {
    for (const packet of packets) this.listener?.(packet);
  }
}

/** A keyholder holding the secret directly, as the real one holds it wrapped. */
export class FakeKeyholder implements KeyholderPort {
  public constructor(private readonly secret: Uint8Array) {}

  public isPaired(): Promise<boolean> {
    return Promise.resolve(true);
  }

  public pair(): Promise<never> {
    return Promise.reject(new Error("not used in these tests"));
  }

  public async startSession(
    _deviceName: string,
    randomCode: Uint8Array,
  ): Promise<SessionStart> {
    return startSession(await importCmacKey(this.secret), randomCode);
  }
}
