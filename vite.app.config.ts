import { defineConfig } from "vite";
import { turboWarpExtension } from "@kubohiroya/vite-plugin-turbowarp-extension";
import { extensionConfig } from "./src/config.js";

/**
 * The extension bundle embedded in the standalone SB3.
 *
 * It differs from the default build in exactly one way: lock control is
 * enabled. The extension ID and every opcode stay the same, so a project saved
 * with one build works with the other.
 *
 * Kept as a separate config so `pnpm run build` cannot turn commands on by
 * accident, and so the two artifacts can be compared.
 */
export default defineConfig({
  define: {
    __SESAME_COMMANDS__: "true",
  },
  // Built straight into the SB3 source tree, where the toolchain embeds it.
  // It is deliberately not placed in dist/ beside the commands-off extension,
  // where the two files would be easy to confuse.
  build: {
    outDir: "app/extensions",
  },
  plugins: [
    turboWarpExtension({
      id: extensionConfig.id,
      name: extensionConfig.name,
      description: `${extensionConfig.description} Lock control is enabled in this build.`,
      author: extensionConfig.author,
      license: extensionConfig.license,
      fileName: `${extensionConfig.id}.js`,
    }),
  ],
});
