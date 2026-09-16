/**
 * The TurboWarp-side half of the keyholder boundary.
 *
 * ADR 0001 puts the device secret on its own origin, so this holds no key and
 * performs no cryptography. It opens the keyholder in a window of its own,
 * talks to it over a private `MessageChannel`, and forwards seal and open
 * requests. Everything crossing this boundary is either already sealed or
 * already public.
 *
 * A window rather than an iframe, for two reasons that point the same way.
 * Chrome partitions storage for a cross-site iframe, so an embedded keyholder
 * gets an empty store rather than the keys the person paired in the keyholder
 * page — confirmed on real hardware, where every session failed with "No
 * Sesame is paired". And pairing needs the camera, which a frame cannot have
 * because the `camera` Permissions Policy defaults to `self`. A window is a
 * top-level browsing context: first-party storage, and its own permissions.
 */

import type {
  KeyholderPort,
  KeyholderSession,
  PairedDevice,
  SessionStart,
} from "./ports.js";
import type { ParsingType } from "./segment.js";

/** Long enough for a biometric prompt, short enough to not hang a project. */
const DEFAULT_TIMEOUT_MS = 120_000;

/** Reusing one window name keeps a second connect from opening a second one. */
const WINDOW_NAME = "sesame-keyholder";

const OFFER_INTERVAL_MS = 400;

interface Request {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export interface RemoteKeyholderOptions {
  /** Absolute https URL of the keyholder page. */
  url: string;
  timeoutMs?: number;
  /** Opens the window. Replaceable in tests. */
  open?: (url: string, name: string) => Window | null;
}

/**
 * Validates a keyholder URL.
 *
 * It must be `https` and carry only an origin and path: a keyholder reached
 * over plain HTTP, or selected by a query string, is not a boundary worth
 * having.
 */
export function validateKeyholderUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new TypeError("Keyholder URL must be a valid URL.");
  }
  if (url.protocol !== "https:") {
    throw new TypeError("Keyholder URL must use HTTPS.");
  }
  if (
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new TypeError("Keyholder URL must contain only an origin and path.");
  }
  return url.toString();
}

export class RemoteKeyholder implements KeyholderPort {
  private readonly url: URL;
  private readonly timeoutMs: number;
  private readonly pending = new Map<number, Request>();
  private port: MessagePort | undefined;
  private window: Window | undefined;
  private connecting: Promise<MessagePort> | undefined;
  private nextId = 1;

  public constructor(private readonly options: RemoteKeyholderOptions) {
    this.url = new URL(validateKeyholderUrl(options.url));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  public async isPaired(deviceName: string): Promise<boolean> {
    return (await this.call("isPaired", { deviceName })) === true;
  }

  public async pair(): Promise<PairedDevice> {
    const result = await this.call("pair", {});
    const record = asRecord(result, "pairing");
    const deviceName = asString(record.deviceName, "deviceName");
    const uuid = asString(record.uuid, "uuid");
    const level = record.level;
    return {
      deviceName,
      uuid,
      ...(typeof level === "string" ? { level: level as never } : {}),
    };
  }

  public async startSession(
    deviceName: string,
    randomCode: Uint8Array,
  ): Promise<SessionStart> {
    const result = await this.call("startSession", { deviceName, randomCode });
    const record = asRecord(result, "session start");
    const sessionId = asString(record.sessionId, "sessionId");
    const loginProof = asBytes(record.loginProof, "loginProof");
    if (loginProof.length !== 4) {
      throw new Error("The keyholder returned a malformed login proof.");
    }
    return { session: new RemoteSession(this, sessionId), loginProof };
  }

  /** True once the keyholder window has answered. */
  public isOpen(): boolean {
    return this.port !== undefined && this.window?.closed !== true;
  }

  /**
   * Opens the keyholder window and waits for it.
   *
   * Separate from the calls that use it because opening a window consumes the
   * page's transient activation, and so does the Bluetooth device chooser. One
   * click cannot pay for both.
   */
  public async ready(): Promise<void> {
    await this.connect();
  }

  /** Closes the window and fails anything still outstanding. */
  public dispose(): void {
    for (const [, request] of this.pending) {
      clearTimeout(request.timer);
      request.reject(new Error("The keyholder connection closed."));
    }
    this.pending.clear();
    this.port?.close();
    this.port = undefined;
    this.connecting = undefined;
    this.window?.close();
    this.window = undefined;
  }

  /** @internal Used by {@link RemoteSession}. */
  public async call(method: string, params: unknown): Promise<unknown> {
    const port = await this.connect();
    const id = this.nextId;
    this.nextId += 1;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(`The keyholder did not answer the ${method} request.`),
        );
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      port.postMessage({ id, method, params });
    });
  }

  private connect(): Promise<MessagePort> {
    if (this.port !== undefined) return Promise.resolve(this.port);
    this.connecting ??= this.open().catch((error: unknown) => {
      this.connecting = undefined;
      throw error;
    });
    return this.connecting;
  }

  private open(): Promise<MessagePort> {
    const opener = this.options.open ?? defaultOpener();
    const child = opener(this.url.toString(), WINDOW_NAME);
    if (child === null) {
      throw new Error(
        "The browser blocked the keyholder window. Allow pop-ups for this site, then try again.",
      );
    }
    this.window = child;

    return new Promise<MessagePort>((resolve, reject) => {
      const timer = setTimeout(() => {
        stop();
        reject(new Error("The keyholder window did not answer."));
      }, this.timeoutMs);

      // The keyholder announces itself once it has loaded, because a
      // cross-origin window gives the opener no load event to wait for. Until
      // the announcement arrives, a fresh port is offered periodically so a
      // window that was already open is picked up too.
      const offer = (): void => {
        const channel = new MessageChannel();
        channel.port1.onmessage = (event: MessageEvent) => {
          const data = event.data as { ready?: boolean } | null;
          if (data?.ready !== true) return;
          stop();
          channel.port1.onmessage = (message: MessageEvent) => {
            this.receive(message);
          };
          this.port = channel.port1;
          resolve(channel.port1);
        };
        try {
          child.postMessage({ sesameKeyholder: 1 }, this.url.origin, [
            channel.port2,
          ]);
        } catch {
          // The window is not ready for a message yet; the next offer retries.
        }
      };

      const announced = (event: MessageEvent): void => {
        if (event.origin !== this.url.origin || event.source !== child) return;
        const data = event.data as { sesameKeyholder?: string } | null;
        if (data?.sesameKeyholder === "ready") offer();
      };
      const host = globalThis as {
        addEventListener?: typeof addEventListener;
        removeEventListener?: typeof removeEventListener;
      };
      host.addEventListener?.("message", announced);
      const retry = setInterval(offer, OFFER_INTERVAL_MS);

      const stop = (): void => {
        clearTimeout(timer);
        clearInterval(retry);
        host.removeEventListener?.("message", announced);
      };
      offer();
    });
  }

  private receive(event: MessageEvent): void {
    const data = event.data as {
      id?: number;
      ok?: boolean;
      value?: unknown;
      error?: unknown;
    } | null;
    if (data === null || typeof data.id !== "number") return;
    const request = this.pending.get(data.id);
    if (request === undefined) return;
    this.pending.delete(data.id);
    clearTimeout(request.timer);
    if (data.ok === true) {
      request.resolve(data.value);
    } else {
      request.reject(
        new Error(
          typeof data.error === "string"
            ? data.error
            : "The keyholder reported an error.",
        ),
      );
    }
  }
}

class RemoteSession implements KeyholderSession {
  public constructor(
    private readonly keyholder: RemoteKeyholder,
    private readonly sessionId: string,
  ) {}

  public async seal(message: Uint8Array): Promise<Uint8Array[]> {
    const result = await this.keyholder.call("seal", {
      sessionId: this.sessionId,
      message,
    });
    if (!Array.isArray(result)) {
      throw new Error("The keyholder returned malformed packets.");
    }
    return result.map((packet, index) => asBytes(packet, `packet ${index}`));
  }

  public async open(
    parsing: ParsingType,
    data: Uint8Array,
  ): Promise<Uint8Array> {
    return asBytes(
      await this.keyholder.call("open", {
        sessionId: this.sessionId,
        parsing,
        data,
      }),
      "frame",
    );
  }

  public async close(): Promise<void> {
    await this.keyholder.call("closeSession", { sessionId: this.sessionId });
  }
}

/**
 * How the window is opened when the caller has not said.
 *
 * Resolved when it is needed rather than at construction, so a test can supply
 * its own opener without a browser being present at all.
 */
function defaultOpener(): (url: string, name: string) => Window | null {
  if (typeof window === "undefined") {
    throw new Error("A keyholder needs a browser window.");
  }
  return (url, name) => window.open(url, name, "width=460,height=680");
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`The keyholder returned a malformed ${what} result.`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`The keyholder returned no ${field}.`);
  }
  return value;
}

function asBytes(value: unknown, what: string): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new Error(`The keyholder returned a malformed ${what}.`);
}
