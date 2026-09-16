import { defineConfig } from "vite";

/**
 * The keyholder page is built separately from the extension bundle.
 *
 * It is a different deliverable for a different origin: the extension is a file
 * people load into TurboWarp, while this is a page served from GitHub Pages.
 * Keeping the builds apart also keeps the extension bundle free of any code
 * that touches a key.
 */
export default defineConfig({
  build: {
    outDir: "docs/keyholder",
    emptyOutDir: false,
    target: "es2020",
    lib: {
      entry: "src/keyholder/main.ts",
      formats: ["es"],
      fileName: () => "keyholder.js",
    },
  },
});
