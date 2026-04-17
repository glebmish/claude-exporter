import esbuild from "esbuild";

const prod = process.argv[2] === "production";

// Content script — IIFE (no top-level imports in content scripts)
await esbuild.build({
  entryPoints: ["extension/src/content.ts"],
  bundle: true,
  format: "iife",
  target: "es2022",
  platform: "browser",
  outfile: "extension/dist/content.js",
  sourcemap: !prod,
});

// Popup
await esbuild.build({
  entryPoints: ["extension/src/popup.ts"],
  bundle: true,
  format: "iife",
  target: "es2022",
  platform: "browser",
  outfile: "extension/dist/popup.js",
  sourcemap: !prod,
});
