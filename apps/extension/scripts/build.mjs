import { build } from "esbuild";

await build({
  entryPoints: ["src/background.ts"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["chrome120"],
  outfile: "dist/background.js",
  sourcemap: true,
  legalComments: "none"
});
