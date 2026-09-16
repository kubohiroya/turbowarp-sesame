import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

/**
 * The keyholder's service worker, built after the page it caches.
 *
 * The cache version is a digest of the exact files being cached, so any change
 * to either one produces a different worker. The browser then sees a new
 * script, installs it, and discards the previous cache. Nothing has to be
 * bumped by hand, and a stale keyholder cannot outlive a deploy.
 */
const cached = ["keyholder.js", "index.html"].map((name) => {
  const path = fileURLToPath(
    new URL(`docs/keyholder/${name}`, import.meta.url),
  );
  try {
    return readFileSync(path);
  } catch {
    throw new Error(
      `Build the keyholder page before its service worker: ${name} is missing.`,
    );
  }
});

const version = createHash("sha256")
  .update(Buffer.concat(cached))
  .digest("hex")
  .slice(0, 16);

export default defineConfig({
  define: {
    __KEYHOLDER_VERSION__: JSON.stringify(version),
  },
  build: {
    outDir: "docs/keyholder",
    emptyOutDir: false,
    target: "es2020",
    lib: {
      entry: "src/keyholder/service-worker.ts",
      formats: ["es"],
      fileName: () => "sw.js",
    },
  },
});
