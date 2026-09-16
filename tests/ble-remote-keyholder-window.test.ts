import { describe, expect, it, vi } from "vitest";
import { RemoteKeyholder } from "../src/ble/remote-keyholder.js";

/**
 * The keyholder is opened as a window rather than embedded.
 *
 * Chrome partitions storage for a cross-site frame, so an embedded keyholder
 * reads an empty store instead of the keys someone paired in the keyholder
 * page. That was confirmed on real hardware: every session failed with "No
 * Sesame is paired". A window is a top-level browsing context and keeps the
 * first-party store.
 */

const URL_ = "https://keys.example.org/";

/** A keyholder window that answers the handshake and one request. */
const fakeWindow = () => {
  const channel = new MessageChannel();
  const posted: unknown[] = [];
  const target = {
    closed: false,
    close: () => {
      target.closed = true;
    },
    postMessage: (
      data: unknown,
      _origin: string,
      transfer?: Transferable[],
    ) => {
      posted.push(data);
      const port = transfer?.[0] as MessagePort | undefined;
      if (port === undefined) return;
      port.onmessage = (event: MessageEvent) => {
        const request = event.data as { id: number; method: string };
        port.postMessage({ id: request.id, ok: true, value: request.method });
      };
      port.start();
      port.postMessage({ ready: true });
    },
  };
  return { target, posted, channel };
};

describe("opening the keyholder", () => {
  it("opens a window and completes the handshake", async () => {
    const { target } = fakeWindow();
    const keyholder = new RemoteKeyholder({
      url: URL_,
      open: () => target as unknown as Window,
    });
    await expect(keyholder.ready()).resolves.toBeUndefined();
    expect(keyholder.isOpen()).toBe(true);
  });

  it("says what to do when the browser blocks the window", async () => {
    const keyholder = new RemoteKeyholder({ url: URL_, open: () => null });
    await expect(keyholder.ready()).rejects.toThrow(/Allow pop-ups/u);
  });

  it("reuses one window rather than opening another", async () => {
    const { target } = fakeWindow();
    const open = vi.fn(() => target as unknown as Window);
    const keyholder = new RemoteKeyholder({ url: URL_, open });
    await keyholder.ready();
    await keyholder.ready();
    await keyholder.isPaired("front-door");
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("closes the window when disposed", async () => {
    const { target } = fakeWindow();
    const keyholder = new RemoteKeyholder({
      url: URL_,
      open: () => target as unknown as Window,
    });
    await keyholder.ready();
    keyholder.dispose();
    expect(target.closed).toBe(true);
    expect(keyholder.isOpen()).toBe(false);
  });

  it("forwards requests once open", async () => {
    const { target } = fakeWindow();
    const keyholder = new RemoteKeyholder({
      url: URL_,
      open: () => target as unknown as Window,
    });
    // The fake answers every request with the method name, which is enough to
    // show the channel carries the call and its reply.
    await expect(keyholder.call("isPaired", { deviceName: "x" })).resolves.toBe(
      "isPaired",
    );
  });

  it("times out rather than hanging when the window never answers", async () => {
    const silent = {
      closed: false,
      close: () => undefined,
      postMessage: () => undefined,
    };
    const keyholder = new RemoteKeyholder({
      url: URL_,
      timeoutMs: 120,
      open: () => silent as unknown as Window,
    });
    await expect(keyholder.ready()).rejects.toThrow(/did not answer/u);
  });
});
