/**
 * The keyholder side of the boundary in ADR 0001.
 *
 * It answers requests from the TurboWarp page over a private `MessageChannel`.
 * Everything it returns is either already sealed or already public: sealed
 * packets, opened frames the device sent, a login proof, and identifiers. No
 * request can ask it for a key.
 *
 * Pairing is not handled here. It needs the camera, which a frame cannot have,
 * so it is delegated to a window the page opens for itself.
 */

import { startSession } from "../ble/keyholder-session.js";
import type { KeyholderSession } from "../ble/ports.js";
import type { ParsingType } from "../ble/segment.js";
import type { PairedRecord } from "./vault.js";

export interface KeyholderBackend {
  /** Whether a device secret is stored under this alias. */
  isPaired(deviceName: string): Promise<boolean>;

  /**
   * Unwraps the device secret for one session, prompting for whatever the
   * record's protection requires.
   */
  unlock(deviceName: string): Promise<CryptoKey>;

  /** Runs the pairing flow in a window this origin controls. */
  pair(): Promise<PairedRecord>;
}

/** Sessions are capped so a misbehaving page cannot accumulate them. */
const MAX_SESSIONS = 4;

export interface KeyholderRequest {
  id: number;
  method: string;
  params: unknown;
}

export class KeyholderServer {
  private readonly sessions = new Map<string, KeyholderSession>();
  private nextSessionId = 1;

  public constructor(private readonly backend: KeyholderBackend) {}

  /** Serves one channel until {@link close} or the page goes away. */
  public listen(port: MessagePort): void {
    port.onmessage = (event: MessageEvent) => {
      void this.dispatch(port, event.data as KeyholderRequest | null);
    };
    port.start?.();
    port.postMessage({ ready: true });
  }

  public async close(): Promise<void> {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(sessions.map((session) => session.close()));
  }

  private async dispatch(
    port: MessagePort,
    request: KeyholderRequest | null,
  ): Promise<void> {
    if (request === null || typeof request.id !== "number") return;
    try {
      const value = await this.handle(request.method, request.params);
      port.postMessage({ id: request.id, ok: true, value });
    } catch (error) {
      port.postMessage({
        id: request.id,
        ok: false,
        // Only the message crosses: a stack would name this origin's internals.
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async handle(method: string, params: unknown): Promise<unknown> {
    const input = asRecord(params);
    switch (method) {
      case "isPaired":
        return this.backend.isPaired(asString(input.deviceName, "deviceName"));

      case "pair":
        return this.backend.pair();

      case "startSession":
        return this.startSession(
          asString(input.deviceName, "deviceName"),
          asBytes(input.randomCode, "randomCode"),
        );

      case "seal":
        return this.session(input).seal(asBytes(input.message, "message"));

      case "open":
        return this.session(input).open(
          asParsing(input.parsing),
          asBytes(input.data, "data"),
        );

      case "closeSession":
        return this.closeSession(asString(input.sessionId, "sessionId"));

      default:
        throw new Error(`Unknown keyholder request: ${method}.`);
    }
  }

  private async startSession(
    deviceName: string,
    randomCode: Uint8Array,
  ): Promise<{ sessionId: string; loginProof: Uint8Array }> {
    if (this.sessions.size >= MAX_SESSIONS) {
      throw new Error("Too many Sesame sessions are open.");
    }
    const secret = await this.backend.unlock(deviceName);
    const { session, loginProof } = await startSession(secret, randomCode);
    const sessionId = `s${String(this.nextSessionId)}`;
    this.nextSessionId += 1;
    this.sessions.set(sessionId, session);
    return { sessionId, loginProof };
  }

  private async closeSession(sessionId: string): Promise<null> {
    const session = this.sessions.get(sessionId);
    this.sessions.delete(sessionId);
    await session?.close();
    return null;
  }

  private session(input: Record<string, unknown>): KeyholderSession {
    const sessionId = asString(input.sessionId, "sessionId");
    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      throw new Error("That Sesame session is not open.");
    }
    return session;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`The ${field} is missing.`);
  }
  return value;
}

function asBytes(value: unknown, field: string): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new TypeError(`The ${field} must be bytes.`);
}

function asParsing(value: unknown): ParsingType {
  if (value === "plain" || value === "cipher") return value;
  throw new TypeError("The parsing type must be plain or cipher.");
}
