import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "./src/index.ts",
    "scripts/backfill-photos": "./src/scripts/backfill-photos.ts",
  },
  format: "esm",
  outDir: "./dist",
  clean: true,
  deps: {
    alwaysBundle: [/@clichy\/.*/],
  },
});
