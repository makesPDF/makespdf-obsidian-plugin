import esbuild from "esbuild";
import process from "process";

const prod = process.argv[2] === "production";

esbuild
  .build({
    entryPoints: ["src/main.ts"],
    bundle: true,
    external: ["obsidian"],
    format: "cjs",
    target: "es2018",
    outfile: "main.js",
    sourcemap: prod ? false : "inline",
    logLevel: "info",
    platform: "browser",
    treeShaking: true,
    minify: prod,
  })
  .catch(() => process.exit(1));
