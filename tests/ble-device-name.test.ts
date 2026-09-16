import { describe, expect, it } from "vitest";
import {
  deviceUuidFromName,
  nameForDeviceUuid,
} from "../src/ble/web-bluetooth.js";

/**
 * Names observed in Chrome's device chooser during real-device testing. A
 * Sesame advertises the base64 of its 16-byte UUID, so the chooser lists
 * something no person would recognise until it is decoded.
 */
describe("names seen in the chooser", () => {
  it("decodes an advertised name into the UUID the sesame app shows", () => {
    expect(deviceUuidFromName("Dp7YKHj4nqnf1Ds8DgHfNA")).toBe(
      "0E9ED828-78F8-9EA9-DFD4-3B3C0E01DF34",
    );
    expect(deviceUuidFromName("ESAEHgUHBgnDAA4B/////w")).toBe(
      "1120041E-0507-0609-C300-0E01FFFFFFFF",
    );
  });

  it("leaves other Candy House products alone", () => {
    // A WiFi Module 2 advertises a plain name and is not a lock.
    expect(deviceUuidFromName("WM2")).toBeUndefined();
  });

  it("returns nothing rather than guessing", () => {
    expect(deviceUuidFromName(undefined)).toBeUndefined();
    expect(deviceUuidFromName("")).toBeUndefined();
    expect(deviceUuidFromName("not base64 !!")).toBeUndefined();
    // Right alphabet, wrong length: 15 bytes is not a UUID.
    expect(
      deviceUuidFromName(Buffer.alloc(15).toString("base64")),
    ).toBeUndefined();
    expect(
      deviceUuidFromName(Buffer.alloc(17).toString("base64")),
    ).toBeUndefined();
  });
});

describe("building the name back", () => {
  it("round-trips every observed name", () => {
    for (const name of ["Dp7YKHj4nqnf1Ds8DgHfNA", "ESAEHgUHBgnDAA4B/////w"]) {
      const uuid = deviceUuidFromName(name);
      expect(uuid).toBeDefined();
      expect(nameForDeviceUuid(uuid ?? "")).toBe(name);
    }
  });

  it("round-trips an arbitrary UUID", () => {
    const uuid = "00010203-0405-0607-0809-0A0B0C0D0E0F";
    expect(deviceUuidFromName(nameForDeviceUuid(uuid))).toBe(uuid);
  });

  it("accepts a UUID written in lower case", () => {
    expect(nameForDeviceUuid("0e9ed828-78f8-9ea9-dfd4-3b3c0e01df34")).toBe(
      "Dp7YKHj4nqnf1Ds8DgHfNA",
    );
  });
});
