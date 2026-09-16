import { describe, expect, it } from "vitest";
import { validateKeyholderUrl } from "../src/ble/remote-keyholder.js";

describe("keyholder URL validation", () => {
  it("accepts an https origin and path", () => {
    expect(validateKeyholderUrl("https://keys.example/keyholder/")).toBe(
      "https://keys.example/keyholder/",
    );
  });

  it("trims surrounding whitespace", () => {
    expect(validateKeyholderUrl("  https://keys.example/k/  ")).toBe(
      "https://keys.example/k/",
    );
  });

  it("rejects plain HTTP, which is not a boundary worth having", () => {
    expect(() => validateKeyholderUrl("http://keys.example/k/")).toThrow(
      /HTTPS/u,
    );
  });

  it("rejects a URL carrying credentials, a query, or a fragment", () => {
    expect(() =>
      validateKeyholderUrl("https://user:pw@keys.example/k/"),
    ).toThrow(/origin and path/u);
    expect(() => validateKeyholderUrl("https://keys.example/k/?a=1")).toThrow(
      /origin and path/u,
    );
    expect(() => validateKeyholderUrl("https://keys.example/k/#x")).toThrow(
      /origin and path/u,
    );
  });

  it("rejects text that is not a URL", () => {
    expect(() => validateKeyholderUrl("keyholder")).toThrow(/valid URL/u);
  });
});
