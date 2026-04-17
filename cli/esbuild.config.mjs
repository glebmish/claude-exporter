import esbuild from "esbuild";

const prod = process.argv[2] === "production";

await esbuild.build({
  entryPoints: ["cli/src/main.ts"],
  bundle: true,
  format: "esm",
  target: "node18",
  platform: "node",
  packages: "external",
  outfile: "cli/dist/main.mjs",
  sourcemap: !prod,
  banner: { js: "#!/usr/bin/env node" },
});
