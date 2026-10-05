/** Build the manually committed REST Client board CodeMirror browser module. */

import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const boardRoot = resolve(repositoryRoot, "assets/boards/rest-client");
const outputFile = resolve(boardRoot, "lib/codemirror.js");

await mkdir(dirname(outputFile), { recursive: true });
await build({
    entryPoints: [resolve(boardRoot, "src/codemirror-entry.js")],
    outfile: outputFile,
    bundle: true,
    format: "esm",
    minify: true,
    platform: "browser",
    target: "es2022",
    logLevel: "info",
});
