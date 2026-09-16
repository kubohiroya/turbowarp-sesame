import { describe, expect, it } from "vitest";
import { aesCmacWithKey } from "../src/aes-cmac.js";
import type { SharedKey } from "../src/ble/share-qr.js";
import { deriveFromPassphrase } from "../src/keyholder/kek.js";
import { MemoryStorage } from "../src/keyholder/storage.js";
import {
  normalizeDeviceName,
  suggestDeviceName,
  Vault,
} from "../src/keyholder/vault.js";

const SECRET = "2b7e151628aed2a6abf7158809cf4f3c";

const sharedKey = (): SharedKey => ({
  model: 5,
  secret: SECRET,
  publicKey: "cdcdcdcd",
  keyIndex: "0000",
  uuid: "00010203-0405-0607-0809-0A0B0C0D0E0F",
  level: "manager",
  name: "front door",
});

const salt = () => Uint8Array.from({ length: 32 }, (_, index) => index);

/** PBKDF2 at production cost is slow; tests use a token count. */
const kek = (passphrase: string) => deriveFromPassphrase(passphrase, salt(), 1);

const protection = { kind: "passphrase" as const, salt: salt(), iterations: 1 };

describe("pairing", () => {
  it("stores the secret wrapped, never in the clear", async () => {
    const storage = new MemoryStorage();
    const vault = new Vault(storage);
    await vault.pair(
      "front-door",
      sharedKey(),
      await kek("correct horse"),
      protection,
    );

    const [record] = await storage.list();
    expect(record).toBeDefined();
    expect(JSON.stringify(record)).not.toContain(SECRET);
    expect(
      Buffer.from(record?.wrappedSecret ?? []).toString("hex"),
    ).not.toContain(SECRET);
    // AES-GCM adds a 16-byte tag to the 16-byte key.
    expect(record?.wrappedSecret).toHaveLength(32);
  });

  it("keeps the identifying fields for display", async () => {
    const vault = new Vault(new MemoryStorage());
    const paired = await vault.pair(
      "front-door",
      sharedKey(),
      await kek("correct horse"),
      protection,
    );
    expect(paired.deviceName).toBe("front-door");
    expect(paired.uuid).toBe("00010203-0405-0607-0809-0A0B0C0D0E0F");
    expect(paired.level).toBe("manager");
  });

  it("uses a fresh initialization vector per pairing", async () => {
    const storage = new MemoryStorage();
    const vault = new Vault(storage);
    const key = await kek("correct horse");
    await vault.pair("one", sharedKey(), key, protection);
    await vault.pair("two", sharedKey(), key, protection);
    const [first, second] = await storage.list();
    expect(Buffer.from(first?.wrapIv ?? []).toString("hex")).not.toBe(
      Buffer.from(second?.wrapIv ?? []).toString("hex"),
    );
    expect(Buffer.from(first?.wrappedSecret ?? []).toString("hex")).not.toBe(
      Buffer.from(second?.wrappedSecret ?? []).toString("hex"),
    );
  });
});

describe("unlocking", () => {
  it("returns a key that computes the right session token", async () => {
    const vault = new Vault(new MemoryStorage());
    await vault.pair(
      "front-door",
      sharedKey(),
      await kek("correct horse"),
      protection,
    );
    const secret = await vault.unlock("front-door", await kek("correct horse"));

    const token = await aesCmacWithKey(
      secret,
      Uint8Array.from([0xde, 0xad, 0xbe, 0xef]),
    );
    // The value aes-cmac.test.ts pins for this key and message.
    expect(Buffer.from(token).toString("hex")).toBe(
      "9a8e5155352c62495143b33d346f95a2",
    );
  });

  it("returns a key that cannot be read back out", async () => {
    const vault = new Vault(new MemoryStorage());
    await vault.pair(
      "front-door",
      sharedKey(),
      await kek("correct horse"),
      protection,
    );
    const secret = await vault.unlock("front-door", await kek("correct horse"));
    expect(secret.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", secret)).rejects.toThrow();
  });

  it("refuses the wrong passphrase without saying what was stored", async () => {
    const vault = new Vault(new MemoryStorage());
    await vault.pair(
      "front-door",
      sharedKey(),
      await kek("correct horse"),
      protection,
    );
    await expect(
      vault.unlock("front-door", await kek("wrong horse")),
    ).rejects.toThrow(/could not be unlocked/u);
  });

  it("reports an unknown device by name", async () => {
    const vault = new Vault(new MemoryStorage());
    await expect(
      vault.unlock("nothing", await kek("correct horse")),
    ).rejects.toThrow(/No Sesame is paired as "nothing"/u);
  });

  it("reports which protection a record needs", async () => {
    const vault = new Vault(new MemoryStorage());
    await vault.pair(
      "front-door",
      sharedKey(),
      await kek("correct horse"),
      protection,
    );
    expect((await vault.protectionFor("front-door")).kind).toBe("passphrase");
  });
});

describe("the device list", () => {
  it("answers has, list, and forget", async () => {
    const vault = new Vault(new MemoryStorage());
    const key = await kek("correct horse");
    expect(await vault.has("front-door")).toBe(false);
    await vault.pair("front-door", sharedKey(), key, protection);
    expect(await vault.has("front-door")).toBe(true);
    expect(await vault.list()).toHaveLength(1);
    await vault.forget("front-door");
    expect(await vault.has("front-door")).toBe(false);
  });

  it("never exposes wrapped material in the listing", async () => {
    const vault = new Vault(new MemoryStorage());
    await vault.pair(
      "front-door",
      sharedKey(),
      await kek("correct horse"),
      protection,
    );
    const [entry] = await vault.list();
    expect(Object.keys(entry ?? {}).sort()).toEqual([
      "deviceName",
      "level",
      "pairedAt",
      "uuid",
    ]);
  });
});

describe("device aliases", () => {
  it("folds case and spaces so one lock is one record", async () => {
    const vault = new Vault(new MemoryStorage());
    const key = await kek("correct horse");
    await vault.pair("Front Door", sharedKey(), key, protection);
    await vault.pair("front-door", sharedKey(), key, protection);
    expect(await vault.list()).toHaveLength(1);
  });

  it("normalizes to the form the extension sends", () => {
    expect(normalizeDeviceName("  Front Door  ")).toBe("front-door");
  });

  it("rejects an alias that is empty or has odd characters", () => {
    expect(() => normalizeDeviceName("")).toThrow(TypeError);
    expect(() => normalizeDeviceName("front/door")).toThrow(TypeError);
    expect(() => normalizeDeviceName("-leading")).toThrow(TypeError);
  });
});

describe("suggesting an alias from a device name", () => {
  it("slugifies a name that can be one", () => {
    expect(suggestDeviceName("Front Door")).toBe("front-door");
    expect(suggestDeviceName("  Back.Gate_2  ")).toBe("back.gate_2");
  });

  it("falls back rather than failing on a name it cannot use", () => {
    // Device names are chosen by people, in whatever script they use.
    expect(suggestDeviceName("玄関")).toBe("sesame");
    expect(suggestDeviceName("🚪")).toBe("sesame");
    expect(suggestDeviceName("")).toBe("sesame");
    expect(suggestDeviceName(undefined)).toBe("sesame");
  });

  it("keeps the part of a mixed name that can be used", () => {
    expect(suggestDeviceName("玄関 door")).toBe("door");
  });

  it("drops leading characters that cannot start an alias", () => {
    expect(suggestDeviceName("--front")).toBe("front");
    expect(suggestDeviceName("...")).toBe("sesame");
  });

  it("always produces something normalizeDeviceName accepts", () => {
    for (const name of [
      "Front Door",
      "玄関",
      "🚪",
      "",
      "--x",
      "A".repeat(200),
    ]) {
      expect(() => normalizeDeviceName(suggestDeviceName(name))).not.toThrow();
    }
  });
});

describe("the alias error", () => {
  it("says what was rejected and what is allowed", () => {
    expect(() => normalizeDeviceName("玄関")).toThrow(/"玄関" cannot be used/u);
    expect(() => normalizeDeviceName("玄関")).toThrow(
      /front-door, for example/u,
    );
  });
});
