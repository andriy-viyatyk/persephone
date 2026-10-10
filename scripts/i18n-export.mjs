import { buildSync } from "esbuild";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const entryPoint = join(scriptDirectory, "i18n-export-entry.ts");
const temporaryDirectory = await mkdtemp(join(tmpdir(), "persephone-i18n-export-"));

try {
    const result = buildSync({
        entryPoints: [entryPoint],
        bundle: true,
        platform: "node",
        format: "esm",
        write: false,
        outfile: join(temporaryDirectory, "entry.mjs"),
    });
    const output = result.outputFiles[0];
    await writeFile(join(temporaryDirectory, "entry.mjs"), output.contents);
    const exporter = await import(pathToFileURL(join(temporaryDirectory, "entry.mjs")).href);
    await exporter.runI18nExport(process.argv.slice(2));
} finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
}
