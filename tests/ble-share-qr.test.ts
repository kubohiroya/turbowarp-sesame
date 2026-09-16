import { describe, expect, it } from "vitest";
import {
  describeShape,
  KeyLevel,
  parseShareQr,
  redact,
  sharedKeyFromParts,
} from "../src/ble/share-qr.js";

/** Builds a share URL the way the sesame app does, for a chosen model. */
const shareUrl = (
  model: number,
  options: { level?: number; name?: string; truncate?: number } = {},
): string => {
  const publicKeyBytes = model >= 5 ? 4 : 64;
  const record = new Uint8Array(1 + 16 + publicKeyBytes + 2 + 16);
  record[0] = model;
  record.fill(0xab, 1, 17); // secret
  record.fill(0xcd, 17, 17 + publicKeyBytes); // public key
  record.fill(0x00, 17 + publicKeyBytes, 19 + publicKeyBytes); // key index
  record.set(
    Uint8Array.from({ length: 16 }, (_, index) => index),
    19 + publicKeyBytes,
  );
  const sliced =
    options.truncate === undefined ? record : record.slice(0, options.truncate);
  const base64 = Buffer.from(sliced).toString("base64");

  const query = new URLSearchParams({ t: "sk", sk: base64 });
  if (options.level !== undefined) query.set("l", String(options.level));
  if (options.name !== undefined) query.set("n", options.name);
  return `ssm://UI?${query.toString()}`;
};

describe("share QR parsing", () => {
  it("reads a SESAME 5 record, which carries a four-byte public key", () => {
    const key = parseShareQr(shareUrl(5, { level: 0, name: "front door" }));
    expect(key).toEqual({
      model: 5,
      secret: "ab".repeat(16),
      publicKey: "cdcdcdcd",
      keyIndex: "0000",
      uuid: "00010203-0405-0607-0809-0A0B0C0D0E0F",
      level: "owner",
      name: "front door",
    });
  });

  it("reads a SESAME 4 record, which carries a sixty-four-byte public key", () => {
    const key = parseShareQr(shareUrl(4));
    expect(key.model).toBe(4);
    expect(key.publicKey).toHaveLength(128);
    expect(key.secret).toBe("ab".repeat(16));
    expect(key.uuid).toBe("00010203-0405-0607-0809-0A0B0C0D0E0F");
  });

  it("treats SESAME 5 Pro like SESAME 5", () => {
    expect(parseShareQr(shareUrl(7)).publicKey).toHaveLength(8);
  });

  it("names each advisory key level", () => {
    expect(parseShareQr(shareUrl(5, { level: KeyLevel.owner })).level).toBe(
      "owner",
    );
    expect(parseShareQr(shareUrl(5, { level: KeyLevel.manager })).level).toBe(
      "manager",
    );
    expect(parseShareQr(shareUrl(5, { level: KeyLevel.guest })).level).toBe(
      "guest",
    );
  });

  it("omits the level rather than guessing when it is absent or unknown", () => {
    expect(parseShareQr(shareUrl(5)).level).toBeUndefined();
    expect(parseShareQr(shareUrl(5, { level: 9 })).level).toBeUndefined();
  });

  it("omits an empty device name", () => {
    expect(parseShareQr(shareUrl(5, { name: "" })).name).toBeUndefined();
  });
});

describe("share QR rejection", () => {
  it("rejects a code that is not a sesame URL", () => {
    expect(() => parseShareQr("https://example.com/")).toThrow(
      /not a sesame sharing QR code/u,
    );
  });

  it("rejects a sesame code that shares something other than a key", () => {
    expect(() => parseShareQr("ssm://UI?t=friend&friend=abc")).toThrow(
      /does not share a key/u,
    );
  });

  it("rejects a key code with no payload", () => {
    expect(() => parseShareQr("ssm://UI?t=sk&sk=")).toThrow(/carries no key/u);
  });

  it("rejects a payload that is not base64", () => {
    expect(() => parseShareQr("ssm://UI?t=sk&sk=!!!!")).toThrow(
      /not valid base64/u,
    );
  });

  it("rejects a record whose length disagrees with its model", () => {
    expect(() => parseShareQr(shareUrl(5, { truncate: 20 }))).toThrow(
      /20 bytes, but model 5 needs 39/u,
    );
    // A SESAME 4 record presented as SESAME 5 is the same kind of mismatch.
    expect(() => parseShareQr(shareUrl(4, { truncate: 39 }))).toThrow(
      /needs 99/u,
    );
  });
});

describe("redaction", () => {
  it("removes the secret while keeping the identifying fields", () => {
    const key = parseShareQr(shareUrl(5, { name: "front door" }));
    const safe = redact(key);
    expect(safe.secret).toBe("[redacted]");
    expect(safe.uuid).toBe(key.uuid);
    expect(safe.name).toBe("front door");
    expect(JSON.stringify(safe)).not.toContain("abab");
  });
});

describe("guest keys", () => {
  /** A guest key as the app writes one: the first eight secret bytes zeroed. */
  const guestUrl = (): string => {
    const record = new Uint8Array(39);
    record[0] = 5;
    record.fill(0x00, 1, 9); // the half the server keeps
    record.fill(0xab, 9, 17);
    record.fill(0xcd, 17, 21);
    const query = new URLSearchParams({
      t: "sk",
      sk: Buffer.from(record).toString("base64"),
      l: "2",
    });
    return `ssm://UI?${query.toString()}`;
  };

  it("rejects a guest key, explaining that the secret is incomplete", () => {
    expect(() => parseShareQr(guestUrl())).toThrow(
      /guest key.*owner or manager/isu,
    );
  });

  it("rejects it on the payload, not on the advisory level", () => {
    // The same payload labelled as an owner key is still a guest key.
    expect(() => parseShareQr(guestUrl().replace("l=2", "l=0"))).toThrow(
      /guest key/iu,
    );
  });
});

describe("base64 that travelled through a URL", () => {
  /**
   * URLSearchParams decodes "+" as a space, and atob then strips it rather
   * than failing. A lost "+" shifts every byte after it, so the payload still
   * decodes — into plausible-looking garbage. This is the failure that first
   * showed up on real hardware.
   */
  const withPlus = (): { url: string; expected: Uint8Array } => {
    // Search until a record whose base64 contains "+" appears, so the test
    // exercises the character that causes the problem.
    for (let seed = 0; seed < 256; seed += 1) {
      const record = new Uint8Array(39);
      record[0] = 5;
      record.fill(seed, 1, 17);
      record.fill((seed * 7) & 0xff, 17, 21);
      record.fill((seed * 13) & 0xff, 21, 39);
      const base64 = Buffer.from(record).toString("base64");
      if (base64.includes("+")) {
        return {
          url: `ssm://UI?t=sk&sk=${base64}&l=1`,
          expected: record,
        };
      }
    }
    throw new Error("no record produced a + in its base64");
  };

  it("restores a plus that URLSearchParams turned into a space", () => {
    const { url, expected } = withPlus();
    const key = parseShareQr(url);
    expect(key.secret).toBe(
      Buffer.from(expected.subarray(1, 17)).toString("hex"),
    );
  });

  it("decodes the same bytes whether the plus arrives as itself or a space", () => {
    const { url } = withPlus();
    const asSpace = url.replace(/\+/gu, " ");
    expect(parseShareQr(asSpace)).toEqual(parseShareQr(url));
  });

  it("still accepts the URL-safe alphabet", () => {
    const record = new Uint8Array(39);
    record[0] = 5;
    record.fill(0xfb, 1, 17); // encodes to a "+" in standard base64
    const standard = Buffer.from(record).toString("base64");
    const urlSafe = standard.replace(/\+/gu, "-").replace(/\//gu, "_");
    expect(parseShareQr(`ssm://UI?t=sk&sk=${urlSafe}`)).toEqual(
      parseShareQr(`ssm://UI?t=sk&sk=${standard}`),
    );
  });
});

describe("a payload this parser does not understand", () => {
  /** A 160-byte payload beginning 0xFD, as the sesame app produced in testing. */
  const unknown = (): string => {
    const record = new Uint8Array(160);
    record[0] = 0xfd;
    record[1] = 0x01;
    record[2] = 0x02;
    record[3] = 0x03;
    return `ssm://UI?t=sk&sk=${Buffer.from(record).toString("base64")}`;
  };

  it("does not pretend the leading byte is a product model", () => {
    expect(() => parseShareQr(unknown())).toThrow(
      /format this project does not know/u,
    );
    expect(() => parseShareQr(unknown())).not.toThrow(/model 253/u);
  });

  it("reports enough shape to identify the format", () => {
    expect(() => parseShareQr(unknown())).toThrow(
      /160 bytes beginning fd 01 02 03/u,
    );
  });

  it("describes shape without revealing anything usable", () => {
    const secret = "ab".repeat(16);
    const record = Uint8Array.from(
      Buffer.concat([
        Buffer.from([0xfd]),
        Buffer.from(secret, "hex"),
        Buffer.alloc(143),
      ]),
    );
    expect(describeShape(record)).toBe("160 bytes beginning fd ab ab ab");
    expect(describeShape(record)).not.toContain(secret);
  });
});

describe("entering a key by hand", () => {
  const SECRET = "2b7e151628aed2a6abf7158809cf4f3c";
  const UUID = "00010203-0405-0607-0809-0A0B0C0D0E0F";

  it("accepts a secret and UUID someone already has", () => {
    const key = sharedKeyFromParts({ secret: SECRET, uuid: UUID });
    expect(key.secret).toBe(SECRET);
    expect(key.uuid).toBe(UUID);
    expect(key.model).toBe(5);
  });

  it("normalizes case and stray whitespace", () => {
    expect(
      sharedKeyFromParts({
        secret: ` ${SECRET.toUpperCase()} `,
        uuid: UUID.toLowerCase(),
      }),
    ).toEqual(sharedKeyFromParts({ secret: SECRET, uuid: UUID }));
  });

  it("rejects a secret of the wrong length or alphabet", () => {
    expect(() =>
      sharedKeyFromParts({ secret: SECRET.slice(0, 30), uuid: UUID }),
    ).toThrow(/32 hexadecimal/u);
    expect(() =>
      sharedKeyFromParts({ secret: `${SECRET.slice(0, 31)}z`, uuid: UUID }),
    ).toThrow(/32 hexadecimal/u);
  });

  it("rejects a guest secret here too", () => {
    expect(() =>
      sharedKeyFromParts({
        secret: `${"0".repeat(16)}abcdef0123456789`,
        uuid: UUID,
      }),
    ).toThrow(/guest key/iu);
  });

  it("rejects a UUID that is not one", () => {
    expect(() =>
      sharedKeyFromParts({ secret: SECRET, uuid: "not-a-uuid" }),
    ).toThrow(/device UUID/u);
  });

  it("rejects a model outside the known range", () => {
    expect(() =>
      sharedKeyFromParts({ secret: SECRET, uuid: UUID, model: 253 }),
    ).toThrow(/Unknown product model/u);
  });

  it("produces a key the vault stores like any other", () => {
    const key = sharedKeyFromParts({
      secret: SECRET,
      uuid: UUID,
      name: "front door",
    });
    expect(redact(key).secret).toBe("[redacted]");
    expect(key.name).toBe("front door");
  });
});

describe("a code whose sk is the secret alone", () => {
  // Observed on real hardware: sk decoded to exactly 16 bytes, so the device
  // identity has to come from elsewhere in the URL.
  const SECRET = "aa968704" + "00".repeat(12);
  const sk = Buffer.from(SECRET, "hex").toString("base64");

  it("pairs when a parameter carries a UUID", () => {
    const key = parseShareQr(
      `ssm://UI?t=sk&sk=${sk}&u=00010203-0405-0607-0809-0A0B0C0D0E0F&n=front%20door`,
    );
    expect(key.secret).toBe(SECRET);
    expect(key.uuid).toBe("00010203-0405-0607-0809-0A0B0C0D0E0F");
    expect(key.name).toBe("front door");
    expect(key.model).toBe(5);
  });

  it("finds the UUID whatever the parameter is called", () => {
    for (const name of ["u", "uuid", "d", "device", "id"]) {
      expect(
        parseShareQr(
          `ssm://UI?t=sk&sk=${sk}&${name}=00010203-0405-0607-0809-0A0B0C0D0E0F`,
        ).uuid,
      ).toBe("00010203-0405-0607-0809-0A0B0C0D0E0F");
    }
  });

  it("accepts a UUID written without dashes", () => {
    expect(
      parseShareQr(`ssm://UI?t=sk&sk=${sk}&u=000102030405060708090a0b0c0d0e0f`)
        .uuid,
    ).toBe("00010203-0405-0607-0809-0A0B0C0D0E0F");
  });

  it("takes the model when one is given", () => {
    expect(
      parseShareQr(
        `ssm://UI?t=sk&sk=${sk}&u=00010203-0405-0607-0809-0A0B0C0D0E0F&m=7`,
      ).model,
    ).toBe(7);
  });

  it("names the parameters when no UUID is among them", () => {
    expect(() => parseShareQr(`ssm://UI?t=sk&sk=${sk}&l=1&n=door`)).toThrow(
      /carries a key but no device UUID \(parameters t, sk, l, n\)/u,
    );
  });

  it("still rejects a guest secret in this form", () => {
    const guest = Buffer.from(
      "0".repeat(16) + "abcdef0123456789",
      "hex",
    ).toString("base64");
    expect(() =>
      parseShareQr(
        `ssm://UI?t=sk&sk=${guest}&u=00010203-0405-0607-0809-0A0B0C0D0E0F`,
      ),
    ).toThrow(/guest key/iu);
  });

  it("does not mistake the secret itself for a UUID", () => {
    // The secret is 16 bytes too, but it is base64 in sk, not hex in a value.
    expect(() => parseShareQr(`ssm://UI?t=sk&sk=${sk}`)).toThrow(
      /no device UUID/u,
    );
  });
});

describe("reporting an unfamiliar code", () => {
  it("lists parameter names, which identify a format but are not secrets", () => {
    const record = new Uint8Array(160);
    record[0] = 0xfd;
    const payload = Buffer.from(record).toString("base64");
    expect(() =>
      parseShareQr(`ssm://UI?t=sk&sk=${payload}&l=2&n=door&x=1`),
    ).toThrow(/parameters t, sk, l, n, x/u);
  });
});
