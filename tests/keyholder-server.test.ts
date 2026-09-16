import { describe, expect, it } from "vitest";
import { SesameBleTransport } from "../src/ble/ble-transport.js";
import type {
  KeyholderPort,
  PairedDevice,
  SessionStart,
} from "../src/ble/ports.js";
import type { ParsingType } from "../src/ble/segment.js";
import { ItemCode } from "../src/ble/protocol.js";
import { KeyholderServer } from "../src/keyholder/server.js";
import { MemoryStorage } from "../src/keyholder/storage.js";
import { deriveFromPassphrase } from "../src/keyholder/kek.js";
import { Vault } from "../src/keyholder/vault.js";
import { FakeSesame } from "./helpers/fake-sesame.js";

const SECRET = "2b7e151628aed2a6abf7158809cf4f3c";
const SECRET_BYTES = Uint8Array.from(Buffer.from(SECRET, "hex"));
const RANDOM_CODE = Uint8Array.from([0xde, 0xad, 0xbe, 0xef]);
const LOCKED = Uint8Array.from([0x4a, 0x0b, 0, 0, 0, 0, 0b0000_0010]);

const salt = () => new Uint8Array(32);
const kek = () => deriveFromPassphrase("correct horse", salt(), 1);

const pairedVault = async () => {
  const vault = new Vault(new MemoryStorage());
  await vault.pair(
    "front-door",
    {
      model: 5,
      secret: SECRET,
      publicKey: "cdcdcdcd",
      keyIndex: "0000",
      uuid: "00010203-0405-0607-0809-0A0B0C0D0E0F",
    },
    await kek(),
    { kind: "passphrase", salt: salt(), iterations: 1 },
  );
  return vault;
};

/**
 * The extension's half of the boundary, over a real MessageChannel.
 *
 * RemoteKeyholder itself needs an iframe, so this speaks the same wire protocol
 * directly: what is under test is that the two halves agree.
 */
class ChannelKeyholder implements KeyholderPort {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();

  public constructor(private readonly port: MessagePort) {
    port.onmessage = (event: MessageEvent) => {
      const data = event.data as {
        id?: number;
        ok?: boolean;
        value?: unknown;
        error?: string;
      };
      if (typeof data.id !== "number") return;
      const request = this.pending.get(data.id);
      this.pending.delete(data.id);
      if (data.ok === true) request?.resolve(data.value);
      else request?.reject(new Error(data.error ?? "unknown"));
    };
    port.start();
  }

  public call(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.port.postMessage({ id, method, params });
    });
  }

  public async isPaired(deviceName: string): Promise<boolean> {
    return (await this.call("isPaired", { deviceName })) === true;
  }

  public pair(): Promise<PairedDevice> {
    return this.call("pair", {}) as Promise<PairedDevice>;
  }

  public async startSession(
    deviceName: string,
    randomCode: Uint8Array,
  ): Promise<SessionStart> {
    const result = (await this.call("startSession", {
      deviceName,
      randomCode,
    })) as { sessionId: string; loginProof: Uint8Array };
    const sessionId = result.sessionId;
    const call = this.call.bind(this);
    return {
      loginProof: new Uint8Array(result.loginProof),
      session: {
        seal: async (message) =>
          ((await call("seal", { sessionId, message })) as Uint8Array[]).map(
            (packet) => new Uint8Array(packet),
          ),
        open: async (parsing: ParsingType, data) =>
          new Uint8Array(
            (await call("open", { sessionId, parsing, data })) as Uint8Array,
          ),
        close: async () => {
          await call("closeSession", { sessionId });
        },
      },
    };
  }
}

const connectHalves = async () => {
  const vault = await pairedVault();
  const channel = new MessageChannel();
  const server = new KeyholderServer({
    isPaired: (deviceName) => vault.has(deviceName),
    unlock: async (deviceName) => vault.unlock(deviceName, await kek()),
    pair: () => Promise.reject(new Error("pairing happens in its own window")),
  });
  const ready = new Promise<void>((resolve) => {
    channel.port1.onmessage = (event: MessageEvent) => {
      if ((event.data as { ready?: boolean }).ready === true) resolve();
    };
    channel.port1.start();
  });
  server.listen(channel.port2);
  await ready;
  return { vault, server, port: channel.port1 };
};

describe("the keyholder wire protocol", () => {
  it("announces itself before serving requests", async () => {
    const { server } = await connectHalves();
    await server.close();
  });

  it("answers isPaired", async () => {
    const { port, server } = await connectHalves();
    const client = new ChannelKeyholder(port);
    expect(await client.isPaired("front-door")).toBe(true);
    expect(await client.isPaired("back-door")).toBe(false);
    await server.close();
  });

  it("reports an unknown method rather than staying silent", async () => {
    const { port, server } = await connectHalves();
    const client = new ChannelKeyholder(port);
    await expect(client.call("exportKey", {})).rejects.toThrow(
      /Unknown keyholder request/u,
    );
    await server.close();
  });

  it("has no request that returns a key", async () => {
    const { port, server } = await connectHalves();
    const client = new ChannelKeyholder(port);
    const start = await client.startSession("front-door", RANDOM_CODE);
    // The login proof is the only key-derived value that crosses, and it is a
    // truncated MAC over a code the device broadcast in the clear.
    expect(start.loginProof).toHaveLength(4);
    for (const method of ["unlock", "getSecret", "protectionFor"]) {
      await expect(
        client.call(method, { deviceName: "front-door" }),
      ).rejects.toThrow(/Unknown keyholder request/u);
    }
    await server.close();
  });

  it("rejects a session id it never issued", async () => {
    const { port, server } = await connectHalves();
    const client = new ChannelKeyholder(port);
    await expect(
      client.call("seal", { sessionId: "s99", message: new Uint8Array([82]) }),
    ).rejects.toThrow(/not open/u);
    await server.close();
  });

  it("refuses to accumulate sessions without limit", async () => {
    const { port, server } = await connectHalves();
    const client = new ChannelKeyholder(port);
    for (let index = 0; index < 4; index += 1) {
      await client.startSession("front-door", RANDOM_CODE);
    }
    await expect(
      client.startSession("front-door", RANDOM_CODE),
    ).rejects.toThrow(/Too many/u);
    await server.close();
  });

  it("closes a session so its id stops working", async () => {
    const { port, server } = await connectHalves();
    const client = new ChannelKeyholder(port);
    const start = await client.startSession("front-door", RANDOM_CODE);
    await start.session.close();
    await expect(start.session.seal(new Uint8Array([82]))).rejects.toThrow(
      /not open/u,
    );
    await server.close();
  });

  it("validates request shapes instead of trusting them", async () => {
    const { port, server } = await connectHalves();
    const client = new ChannelKeyholder(port);
    await expect(client.call("startSession", {})).rejects.toThrow(
      /deviceName/u,
    );
    await expect(
      client.call("startSession", {
        deviceName: "front-door",
        randomCode: "nope",
      }),
    ).rejects.toThrow(/must be bytes/u);
    await server.close();
  });
});

describe("the two halves against a lock", () => {
  it("logs in and operates the lock end to end", async () => {
    const { port, server } = await connectHalves();
    const device = new FakeSesame(SECRET_BYTES, RANDOM_CODE);
    const transport = new SesameBleTransport({
      channel: device,
      keyholder: new ChannelKeyholder(port),
      deviceName: "front-door",
      timeouts: { randomCode: 500, login: 500, command: 500, status: 500 },
    });

    await transport.connect();
    expect(device.loggedIn).toBe(true);

    const seen: unknown[] = [];
    const arrived = new Promise<void>((resolve) => {
      transport.onStatusChange((status) => {
        seen.push(status.CHSesame2Status);
        resolve();
      });
    });
    await device.publishStatus(LOCKED);
    await arrived;
    expect(seen).toEqual(["locked"]);

    await transport.sendCommand("unlock", "scratch");
    expect(device.requests.some((r) => r.itemCode === ItemCode.unlock)).toBe(
      true,
    );

    await transport.close();
    await server.close();
  });

  it("fails to log in when the vault holds a different secret", async () => {
    const vault = new Vault(new MemoryStorage());
    await vault.pair(
      "front-door",
      {
        model: 5,
        secret: "00".repeat(16),
        publicKey: "cdcdcdcd",
        keyIndex: "0000",
        uuid: "00010203-0405-0607-0809-0A0B0C0D0E0F",
      },
      await kek(),
      { kind: "passphrase", salt: salt(), iterations: 1 },
    );
    const channel = new MessageChannel();
    const server = new KeyholderServer({
      isPaired: (deviceName) => vault.has(deviceName),
      unlock: async (deviceName) => vault.unlock(deviceName, await kek()),
      pair: () => Promise.reject(new Error("not here")),
    });
    const ready = new Promise<void>((resolve) => {
      channel.port1.onmessage = (event: MessageEvent) => {
        if ((event.data as { ready?: boolean }).ready === true) resolve();
      };
      channel.port1.start();
    });
    server.listen(channel.port2);
    await ready;

    const transport = new SesameBleTransport({
      channel: new FakeSesame(SECRET_BYTES, RANDOM_CODE),
      keyholder: new ChannelKeyholder(channel.port1),
      deviceName: "front-door",
      timeouts: { randomCode: 500, login: 500, command: 500, status: 500 },
    });
    await expect(transport.connect()).rejects.toThrow(/refused to log in/u);
    await server.close();
  });

  it("surfaces a locked vault as an error the project can read", async () => {
    const vault = await pairedVault();
    const channel = new MessageChannel();
    const server = new KeyholderServer({
      isPaired: (deviceName) => vault.has(deviceName),
      unlock: () => Promise.reject(new Error("The key could not be unlocked.")),
      pair: () => Promise.reject(new Error("not here")),
    });
    const ready = new Promise<void>((resolve) => {
      channel.port1.onmessage = (event: MessageEvent) => {
        if ((event.data as { ready?: boolean }).ready === true) resolve();
      };
      channel.port1.start();
    });
    server.listen(channel.port2);
    await ready;

    const transport = new SesameBleTransport({
      channel: new FakeSesame(SECRET_BYTES, RANDOM_CODE),
      keyholder: new ChannelKeyholder(channel.port1),
      deviceName: "front-door",
      timeouts: { randomCode: 500, login: 500, command: 500, status: 500 },
    });
    await expect(transport.connect()).rejects.toThrow(/could not be unlocked/u);
    await server.close();
  });
});
