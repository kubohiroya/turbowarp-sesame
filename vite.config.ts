import { defineConfig } from "vite";
import { turboWarpExtension } from "@kubohiroya/vite-plugin-turbowarp-extension";
import definitions from "./src/block-definitions.json" with { type: "json" };
import { extensionConfig } from "./src/config.js";
import { extensionManifestPlugin } from "./src/extension-manifest.js";

export default defineConfig({
  // The default build has lock control off. vite.app.config.ts is the only
  // place that turns it on, for the standalone SB3.
  define: {
    __SESAME_COMMANDS__: "false",
  },
  plugins: [
    turboWarpExtension({
      id: extensionConfig.id,
      name: extensionConfig.name,
      description: extensionConfig.description,
      author: extensionConfig.author,
      license: extensionConfig.license,
      fileName: `${extensionConfig.slug}.js`,
    }),
    extensionManifestPlugin({
      id: extensionConfig.id,
      definitions,
    }),
  ],
});
