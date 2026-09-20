/**
 * Manually generate the committed Excalidraw board library.
 *
 * The Excalidraw package already ships a prebuilt browser ESM graph, so that graph is
 * copied byte-for-byte and never re-bundled: its chunk filenames, `import.meta.url`
 * worker contract and relative font paths all have to survive intact. Only the bare
 * dependency specifiers it leaves external are bundled here, and the board resolves
 * those through an import map.
 *
 * Per EPIC-109 D9 this script is deliberately NOT part of any product build. Run it by
 * hand when @excalidraw/excalidraw is bumped, then commit the result.
 */

import { build } from "esbuild";
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const boardRoot = join(repositoryRoot, "assets", "boards", "excalidraw");
const boardPage = join(boardRoot, "index.html");
const vendorPackageDirectory = join(repositoryRoot, "node_modules", "@excalidraw", "excalidraw");
const vendorRoot = join(vendorPackageDirectory, "dist", "prod");
const libraryRoot = join(boardRoot, "lib");
const dependencyRoot = join(libraryRoot, "deps");

// EPIC-109 D9: the Chinese handwriting family is 13 MB of the package's 14 MB of fonts,
// and the other 54 locales are 1.8 MB. Excluding them is what keeps the committed board
// at roughly 3.7 MB. A version bump must not quietly re-add them.
const excludedFontFamily = "fonts/Xiaolai/";
const keptLocalePrefix = "locales/en-";

const importMapStartMarker = "<!-- import-map:start -->";
const importMapEndMarker = "<!-- import-map:end -->";

// react-dom/client is not imported by the vendor graph; the board's own bootstrap needs
// it for createRoot(), so it is requested explicitly.
const additionalSpecifiers = ["react-dom/client"];

const virtualEntryPrefix = "board-dep:";
const virtualEntryNamespace = "board-dep";

function toPosixPath(value) {
    return value.split("\\").join("/");
}

async function collectFiles(root) {
    const found = [];
    async function walk(directory) {
        let entries;
        try {
            entries = await readdir(directory, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const absolute = join(directory, entry.name);
            if (entry.isDirectory()) await walk(absolute);
            else found.push(toPosixPath(relative(root, absolute)));
        }
    }
    await walk(root);
    return found.sort();
}

function isKeptVendorFile(filePath) {
    if (filePath.startsWith(excludedFontFamily)) return false;
    if (filePath.startsWith("locales/") && !filePath.startsWith(keptLocalePrefix)) return false;
    return true;
}

async function copyVendorGraph() {
    await rm(libraryRoot, { recursive: true, force: true });
    const sourceFiles = await collectFiles(vendorRoot);
    if (sourceFiles.length === 0) {
        throw new Error(`No vendor files found under ${vendorRoot}. Is @excalidraw/excalidraw installed?`);
    }

    const copiedFiles = [];
    for (const filePath of sourceFiles) {
        if (!isKeptVendorFile(filePath)) continue;
        const target = join(libraryRoot, filePath);
        await mkdir(dirname(target), { recursive: true });
        await copyFile(join(vendorRoot, filePath), target);

        // The whole strategy rests on these files being untouched, so prove it rather
        // than trust the copy.
        const source = await readFile(join(vendorRoot, filePath));
        const written = await readFile(target);
        if (!source.equals(written)) {
            throw new Error(`Vendor file changed while copying: ${filePath}`);
        }
        copiedFiles.push(filePath);
    }

    const localeFiles = copiedFiles.filter((filePath) => filePath.startsWith("locales/"));
    if (localeFiles.length !== 1) {
        throw new Error(`Expected exactly one locale file, found: ${localeFiles.join(", ") || "none"}`);
    }
    const fontFamilies = new Set(
        copiedFiles
            .filter((filePath) => filePath.startsWith("fonts/"))
            .map((filePath) => filePath.split("/")[1]),
    );
    if (fontFamilies.has("Xiaolai")) {
        throw new Error("Xiaolai was copied; the D9 font exclusion is broken.");
    }

    return { sourceFiles, copiedFiles, localeFile: localeFiles[0], fontFamilies };
}

// A verbatim copy is only safe if every relative reference still lands on a file that
// was kept. This is what would catch an over-eager exclusion filter.
async function validateRelativeTargets(copiedFiles, localeFile) {
    const referencePattern = /(?:from|import\(|url\()\s*["']?(\.[^"')]*)["']?/g;
    for (const filePath of copiedFiles) {
        if (!filePath.endsWith(".js") && !filePath.endsWith(".css")) continue;
        const source = await readFile(join(libraryRoot, filePath), "utf8");
        for (const match of source.matchAll(referencePattern)) {
            const reference = match[1].split("?")[0].split("#")[0];
            const targetPath = toPosixPath(
                relative(libraryRoot, resolve(dirname(join(libraryRoot, filePath)), reference)),
            );
            // Non-English locales are referenced by 55 literal import() calls in the
            // vendor entry. Only the active locale is ever loaded, so the other 54
            // references are deliberately left dangling.
            if (targetPath.startsWith("locales/") && !targetPath.startsWith(keptLocalePrefix)) continue;
            if (targetPath.startsWith(excludedFontFamily)) continue;
            try {
                await readFile(join(libraryRoot, targetPath));
            } catch {
                throw new Error(`Missing relative target ${targetPath} referenced by ${filePath}.`);
            }
        }
    }

    const localeSource = await readFile(join(libraryRoot, localeFile), "utf8");
    if (!localeSource.includes("../chunk-")) {
        throw new Error(`${localeFile} no longer references a sibling vendor chunk; the copy layout changed.`);
    }
}

function toOutputName(specifier) {
    return specifier.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// The board must supply every bare specifier the vendor graph imports. That set is
// derived from the copied files rather than hand-listed: a hand-list drawn from index.js
// alone missed thirteen specifiers that live in the chunks, each of which would have
// failed at its first import. Deriving it also means a version bump cannot add one
// silently.
async function scanVendorSpecifiers(copiedFiles) {
    const bareSpecifierPattern = /(?:from|import\()\s*"([^"./][^"]*)"/g;
    // `import X from"spec"` and `import X,{a}from"spec"` bind a default; re-exporting
    // `default` from a module that has none is a build error, so the distinction must
    // come from the source rather than a guess.
    const defaultImportPattern = /import\s+[A-Za-z_$][\w$]*\s*(?:,\s*\{[^}]*\})?\s*from\s*"([^"./][^"]*)"/g;

    // Which named bindings each specifier is imported with. The packages cannot be
    // executed to discover their export surface - several are browser-only, and
    // browser-fs-access declares "type": "module" while its dist file is CommonJS, so
    // Node refuses to load it either way. The set that actually has to exist is exactly
    // the set the consumer imports, and that is readable from the source.
    const namedImportPattern = /import\s*(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]*)\}\s*from\s*"([^"./][^"]*)"/g;
    const namedReExportPattern = /export\s*\{([^}]*)\}\s*from\s*"([^"./][^"]*)"/g;

    // `import*as Popover from"@radix-ui/react-popover"` binds NO names, so the patterns
    // above see nothing and the entry is emitted as a bare side-effect import - an empty
    // module whose every member reads `undefined`. That is what shipped in US-1486: both
    // Radix entries were 0 bytes, and the board died with React error #130 as soon as a
    // tool opened a popover. A namespace consumer needs the whole surface.
    const namespaceImportPattern = /import\s*\*\s*as\s+[A-Za-z_$][\w$]*\s*from\s*"([^"./][^"]*)"/g;

    // A dynamic `import("spec")` binds no names either, and the graph consumes the result
    // three different ways: as a whole namespace (`u.parseMermaidToExcalidraw`), as just
    // the default (`.then(i => i.default)`), or not at all - canvas-roundrect-polyfill is
    // awaited purely for its side effect and correctly has no exports. One shape for all
    // three would be wrong in two of them, so the use is classified from the call site.
    const dynamicImportPattern = /import\(\s*"([^"./][^"]*)"\s*\)/g;

    const specifiers = new Set(additionalSpecifiers);
    const defaultImported = new Set();
    const namespaceImported = new Set();
    const sideEffectOnly = new Set();
    const namedImports = new Map();
    const addNames = (specifier, clause) => {
        const names = namedImports.get(specifier) ?? new Set();
        for (const binding of clause.split(",")) {
            // `createPortal as GC` - the local alias is irrelevant; the source name is
            // what must exist on the module.
            const name = binding.trim().split(/\s+as\s+/)[0].trim();
            if (name && isValidExportName(name)) names.add(name);
        }
        namedImports.set(specifier, names);
    };

    for (const filePath of copiedFiles) {
        if (!filePath.endsWith(".js")) continue;
        const source = await readFile(join(libraryRoot, filePath), "utf8");
        for (const match of source.matchAll(bareSpecifierPattern)) specifiers.add(match[1]);
        for (const match of source.matchAll(defaultImportPattern)) defaultImported.add(match[1]);
        for (const match of source.matchAll(namedImportPattern)) addNames(match[2], match[1]);
        for (const match of source.matchAll(namedReExportPattern)) addNames(match[2], match[1]);
        for (const match of source.matchAll(namespaceImportPattern)) namespaceImported.add(match[1]);
        for (const match of source.matchAll(dynamicImportPattern)) {
            const specifier = match[1];
            const tail = match.index + match[0].length;
            const before = source.slice(Math.max(0, match.index - 24), match.index);
            const after = source.slice(tail, tail + 48);
            // `x=await import(...)`, `key:import(...)`, `import(...).then(...)` and
            // `(await import(...)).member` all keep the module object; a bare statement
            // discards it and wants nothing re-exported.
            const resultUsed = /[=:]\s*(?:await\s+)?$/u.test(before) || /^\s*[.)]/u.test(after);
            if (!resultUsed) {
                sideEffectOnly.add(specifier);
            } else if (/^[^;]{0,40}\.default/u.test(after)) {
                defaultImported.add(specifier);
            } else {
                namespaceImported.add(specifier);
            }
        }
    }

    // The board's own bootstrap imports these, so they are required even though the
    // vendor graph never asks for them.
    addNames("react", "createElement");
    addNames("react-dom/client", "createRoot");

    return {
        specifiers: [...specifiers].sort(),
        defaultImported,
        namespaceImported,
        sideEffectOnly,
        namedImports,
    };
}

function isValidExportName(name) {
    return /^[$A-Z_a-z][$\w]*$/u.test(name) && name !== "default";
}

function collectDependencies(
    specifiers, defaultImported, namespaceImported, sideEffectOnly, namedImports,
) {
    const dependencies = new Map();
    for (const specifier of specifiers) {
        dependencies.set(specifier, {
            names: [...(namedImports.get(specifier) ?? new Set())].sort(),
            hasDefault: defaultImported.has(specifier),
            needsNamespace: namespaceImported.has(specifier),
            sideEffectOnly: sideEffectOnly.has(specifier),
            bundleWithReact: false,
        });
    }
    return dependencies;
}

function createVirtualEntryPlugin(specifiers, dependencies) {
    // Entry points must be resolved by esbuild, not by createRequire(). A Node require
    // picks the "require" condition and hands esbuild a concrete file path, which
    // defeats the package's "browser" condition: nanoid then resolves to index.cjs and
    // fails on `crypto`, where its browser build reads crypto.getRandomValues off the
    // global. Routing each entry through a virtual module whose resolveDir is the
    // Excalidraw package makes esbuild resolve exactly as the vendor graph would,
    // nested dependencies included.
    return {
        name: "board-dependency-entries",
        setup(pluginBuild) {
            pluginBuild.onResolve({ filter: /^board-dep:/ }, (args) => ({
                path: args.path.slice(virtualEntryPrefix.length),
                namespace: virtualEntryNamespace,
            }));

            // Externality is decided here rather than with esbuild's `external` option,
            // because each virtual entry imports the very specifier it is named after.
            // A config-level external list matches that self-import too and emits an
            // empty stub instead of the bundled package. React and its DOM/runtime
            // siblings are always resolved for real; splitting then factors their one
            // React module into a shared chunk instead of leaving require("react") in
            // the browser output.
            pluginBuild.onResolve({ filter: /.*/ }, (args) => {
                if (args.namespace === virtualEntryNamespace && args.path === args.importer) return undefined;
                if (specifiers.includes(args.path) && !dependencies.get(args.path).bundleWithReact) {
                    return { path: args.path, external: true };
                }
                return undefined;
            });

            pluginBuild.onLoad({ filter: /.*/, namespace: virtualEntryNamespace }, (args) => {
                const quoted = JSON.stringify(args.path);
                const dependency = dependencies.get(args.path);
                if (!dependency) throw new Error(`Missing module inspection for ${args.path}.`);

                const lines = [];
                if (dependency.needsNamespace) {
                    // A namespace consumer reads arbitrary members, so the whole surface
                    // has to come across. `export *` works here only because every
                    // namespace-read package resolves to a real ESM build, where the names
                    // are statically known; it cannot re-export CommonJS bindings, which is
                    // why the explicit named path below exists at all.
                    lines.push(`export * from ${quoted};`);
                } else if (dependency.names.length) {
                    lines.push(`export { ${dependency.names.join(", ")} } from ${quoted};`);
                }
                if (dependency.hasDefault) lines.push(`export { default } from ${quoted};`);
                if (!lines.length) lines.push(`import ${quoted};`);
                return { contents: lines.join("\n"), resolveDir: vendorPackageDirectory };
            });
        },
    };
}

async function buildDependencies(specifiers, dependencies) {
    const entryPoints = Object.fromEntries(
        specifiers.map((specifier) => [toOutputName(specifier), `${virtualEntryPrefix}${specifier}`]),
    );

    await build({
        bundle: true,
        entryPoints,
        // Without this define esbuild resolves `process.env.NODE_ENV` to "development"
        // and silently bundles React's development build: ~900 KB larger, slower on
        // every render and noisy in the board console. The vendor graph beside it is
        // production, so the two must agree.
        define: { "process.env.NODE_ENV": JSON.stringify("production") },
        format: "esm",
        minify: true,
        outdir: dependencyRoot,
        platform: "browser",
        plugins: [createVirtualEntryPlugin(specifiers, dependencies)],
        splitting: true,
        chunkNames: "shared-[hash]",
        logLevel: "warning",
    });

    // React's development build formats warnings with "%s"; production contains none.
    // It is a string literal, so it survives minification and catches a lost define that
    // the emitted file list alone would not.
    const reactOutput = await readFile(join(dependencyRoot, "react.js"), "utf8");
    if (reactOutput.includes("%s")) {
        throw new Error("deps/react.js carries development-only warning formatting; the production define did not apply.");
    }

    // Every entry must actually expose something. An entry that emits an empty file, or
    // carries no export while the graph reads members off it, is a dependency whose
    // bindings were never derived: it imports cleanly, then reads `undefined` for every
    // member, and surfaces far away as a React "element type is invalid" crash rather
    // than as a build failure. US-1486 shipped two such entries at 0 bytes.
    for (const specifier of specifiers) {
        const outputName = toOutputName(specifier);
        const entrySource = await readFile(join(dependencyRoot, `${outputName}.js`), "utf8");
        if (entrySource.trim() === "") {
            throw new Error(
                `deps/${outputName}.js is empty; "${specifier}" produced no bindings. A form `
                + "the scanner does not recognize yields an entry with nothing in it.",
            );
        }
        if (!dependencies.get(specifier).sideEffectOnly && !/export\s*[{*]/u.test(entrySource)) {
            throw new Error(
                `deps/${outputName}.js carries no export; "${specifier}" would read as `
                + "undefined for every member at runtime.",
            );
        }
    }

    const emitted = await collectFiles(dependencyRoot);
    const expected = specifiers.map((specifier) => `${toOutputName(specifier)}.js`).sort();
    const unexpected = emitted.filter(
        (filePath) => !expected.includes(filePath) && !/^shared-[A-Za-z0-9_-]+\.js$/u.test(filePath),
    );
    const missing = expected.filter((filePath) => !emitted.includes(filePath));
    if (unexpected.length || missing.length) {
        throw new Error(`Unexpected dependency output. Missing: ${missing.join(", ") || "none"}; unexpected: ${unexpected.join(", ") || "none"}`);
    }
}

// The import map is generated into the board page rather than maintained by hand, so it
// cannot drift from the set that was actually emitted.
async function writeImportMap(specifiers) {
    const entries = specifiers
        .map((specifier) => {
            const target = `./lib/deps/${toOutputName(specifier)}.js`;
            return `            ${JSON.stringify(specifier)}: ${JSON.stringify(target)}`;
        })
        .join(",\n");
    const page = await readFile(boardPage, "utf8");
    const start = page.indexOf(importMapStartMarker);
    const end = page.indexOf(importMapEndMarker);
    if (start === -1 || end === -1) {
        throw new Error(`${boardPage} is missing the ${importMapStartMarker} / ${importMapEndMarker} markers.`);
    }
    const generated = [
        importMapStartMarker,
        '    <script type="importmap">',
        "    {",
        '        "imports": {',
        entries,
        "        }",
        "    }",
        "    </script>",
        "    ",
    ].join("\n");
    await writeFile(boardPage, page.slice(0, start) + generated + page.slice(end), "utf8");
    return specifiers.length;
}

await mkdir(boardRoot, { recursive: true });
const { sourceFiles, copiedFiles, localeFile, fontFamilies } = await copyVendorGraph();
await validateRelativeTargets(copiedFiles, localeFile);
const {
    specifiers, defaultImported, namespaceImported, sideEffectOnly, namedImports,
} = await scanVendorSpecifiers(copiedFiles);
const dependencies = collectDependencies(
    specifiers, defaultImported, namespaceImported, sideEffectOnly, namedImports,
);
for (const specifier of ["react", "react-dom", "react-dom/client", "react/jsx-runtime"]) {
    dependencies.get(specifier).bundleWithReact = true;
}
await buildDependencies(specifiers, dependencies);
const mappedCount = await writeImportMap(specifiers);

console.log(`Copied ${copiedFiles.length} of ${sourceFiles.length} vendor files verbatim.`);
console.log(`Kept ${localeFile} and ${fontFamilies.size} font families; excluded Xiaolai and non-English locales.`);
console.log(`Bundled ${specifiers.length} dependencies into ${dependencyRoot}.`);
console.log(`Wrote ${mappedCount} import-map entries into ${boardPage}.`);
