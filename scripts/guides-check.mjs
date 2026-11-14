import { buildSync } from "esbuild";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const entryPoint = join(scriptDirectory, "guides-check-entry.ts");
const temporaryDirectory = await mkdtemp(join(tmpdir(), "persephone-guides-check-"));

try {
    const result = buildSync({
        entryPoints: [entryPoint],
        bundle: true,
        platform: "node",
        format: "esm",
        write: false,
        outfile: join(temporaryDirectory, "entry.mjs"),
    });
    await writeFile(join(temporaryDirectory, "entry.mjs"), result.outputFiles[0].contents);
    const checker = await import(pathToFileURL(join(temporaryDirectory, "entry.mjs")).href);
    await checker.runGuidesCheck(process.argv.slice(2));
} finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
}
