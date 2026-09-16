import { describe, expect, it } from "vitest";
import {
  cachedPathFor,
  cacheName,
  PRECACHE_PATHS,
  staleCaches,
} from "../src/keyholder/sw-policy.js";

const SCOPE = "https://keys.example.org/";

const get = (url: string, mode = "cors") => ({ url, method: "GET", mode });

describe("what the worker answers", () => {
  it("answers a page load with the page", () => {
    expect(cachedPathFor(get(SCOPE, "navigate"), SCOPE)).toBe("index.html");
    expect(cachedPathFor(get(`${SCOPE}index.html`, "navigate"), SCOPE)).toBe(
      "index.html",
    );
  });

  it("answers the root and index.html the same way", () => {
    expect(cachedPathFor(get(SCOPE), SCOPE)).toBe("index.html");
    expect(cachedPathFor(get(`${SCOPE}index.html`), SCOPE)).toBe("index.html");
  });

  it("answers the script", () => {
    expect(cachedPathFor(get(`${SCOPE}keyholder.js`), SCOPE)).toBe(
      "keyholder.js",
    );
  });

  it("caches nothing beyond what the page needs", () => {
    expect(PRECACHE_PATHS).toEqual(["index.html", "keyholder.js"]);
  });
});

describe("what the worker stays out of", () => {
  it("does not handle anything cross-origin", () => {
    expect(
      cachedPathFor(get("https://evil.example/keyholder.js"), SCOPE),
    ).toBeUndefined();
    expect(
      cachedPathFor(get("https://keys.example.org.evil.test/"), SCOPE),
    ).toBeUndefined();
    // Same host, different scheme, is a different origin.
    expect(
      cachedPathFor(get("http://keys.example.org/"), SCOPE),
    ).toBeUndefined();
  });

  it("does not handle requests outside its scope", () => {
    const scoped = "https://keys.example.org/keyholder/";
    expect(
      cachedPathFor(get("https://keys.example.org/other/"), scoped),
    ).toBeUndefined();
    expect(cachedPathFor(get(`${scoped}keyholder.js`), scoped)).toBe(
      "keyholder.js",
    );
  });

  it("does not handle anything that is not a GET", () => {
    for (const method of ["POST", "PUT", "DELETE", "HEAD"]) {
      expect(
        cachedPathFor({ url: SCOPE, method, mode: "navigate" }, SCOPE),
      ).toBeUndefined();
    }
  });

  it("does not handle files it was never asked to cache", () => {
    expect(cachedPathFor(get(`${SCOPE}sw.js`), SCOPE)).toBeUndefined();
    expect(cachedPathFor(get(`${SCOPE}anything.json`), SCOPE)).toBeUndefined();
    expect(
      cachedPathFor(get(`${SCOPE}sub/keyholder.js`), SCOPE),
    ).toBeUndefined();
  });

  it("treats a malformed URL as none of its business", () => {
    expect(cachedPathFor(get("not a url"), SCOPE)).toBeUndefined();
    expect(cachedPathFor(get(SCOPE), "not a url")).toBeUndefined();
  });
});

describe("cache versions", () => {
  it("names a cache after the build", () => {
    expect(cacheName("abc123")).toBe("sesame-keyholder-abc123");
  });

  it("removes caches from other builds and nothing else", () => {
    const current = cacheName("new");
    expect(
      staleCaches(
        [cacheName("old"), current, "some-other-app-cache", "workbox-runtime"],
        current,
      ),
    ).toEqual([cacheName("old")]);
  });

  it("keeps the current cache when it is the only one", () => {
    const current = cacheName("only");
    expect(staleCaches([current], current)).toEqual([]);
  });
});
