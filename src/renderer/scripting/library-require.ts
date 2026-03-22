import { getSucraseTransform } from "./transpile";

const fs = require("fs") as typeof import("fs");
import { fpJoin, fpResolve } from "../core/utils/file-path";
const LIBRARY_PREFIX = "library/";

let extensionsRegistered = false;

/**
 * One-line prefix injected at the top of every library module AND top-level scripts.
 * Makes script context globals available as local variables.
 * Uses optional chaining so modules loaded outside script execution get undefined.
 *
 * `ui` and `console` are NOT included — they are lazy getters on globalThis
 * (set by ScriptContext) to avoid eagerly creating the Log View page.
 */
export const CONTEXT_PREFIX =
    "var app=globalThis.__scriptContext__?.app" +
    ",page=globalThis.__scriptContext__?.page" +
    ",React=globalThis.__scriptContext__?.React" +
    ",styledText=globalThis.__scriptContext__?.styledText" +
    ",preventOutput=globalThis.__scriptContext__?.preventOutput" +
    ",require=globalThis.__scriptContext__?.require||require" +
    ",console=globalThis.__scriptContext__?.console||console" +
    ";\n";

/**
 * Register custom extension handlers for Node.js require():
 * - `.ts` — transpiles TypeScript + ES module imports via sucrase
 * - `.js` — transpiles ES module imports via sucrase (for library files using export/import)
 *
 * Both handlers inject script context globals (app, page, etc.) so library
 * modules have access to the same context as the top-level script.
 *
 * The `.js` handler only applies to files inside the library folder to avoid
 * breaking non-library CommonJS modules.
 *
 * Must be called after `ensureSucraseLoaded()`.
 */
export function registerLibraryExtensions(libraryPath: string): void {
    if (extensionsRegistered) return;
    extensionsRegistered = true;

    const originalJsHandler = require.extensions[".js"];
    const normalizedLibPath = fpResolve(libraryPath);

    require.extensions[".ts"] = (module: NodeModule, filename: string) => {
        const transform = getSucraseTransform();
        if (!transform) {
            originalJsHandler(module, filename);
            return;
        }

        const code = fs.readFileSync(filename, "utf-8");
        const { code: compiled } = transform(code, {
            transforms: ["typescript", "imports"],
            filePath: filename,
        });
        (module as any)._compile(CONTEXT_PREFIX + compiled, filename);
    };

    require.extensions[".js"] = (module: NodeModule, filename: string) => {
        // Only transpile .js files inside the library folder
        const transform = getSucraseTransform();
        if (transform && fpResolve(filename).startsWith(normalizedLibPath)) {
            const code = fs.readFileSync(filename, "utf-8");
            const { code: compiled } = transform(code, {
                transforms: ["imports"],
                filePath: filename,
            });
            (module as any)._compile(CONTEXT_PREFIX + compiled, filename);
            return;
        }

        // Non-library .js files use the original handler
        originalJsHandler(module, filename);
    };
}

/**
 * Clear all require.cache entries under the library folder.
 */
export function clearLibraryRequireCache(libraryPath: string): void {
    const normalizedLibPath = fpResolve(libraryPath);
    for (const key of Object.keys(require.cache)) {
        if (key.startsWith(normalizedLibPath)) {
            delete require.cache[key];
        }
    }
}

/**
 * Resolve a library module path to an absolute file path.
 * Tries: exact, .ts, .js, /index.ts, /index.js
 */
function resolveLibraryModule(libraryPath: string, modulePath: string): string {
    const basePath = fpJoin(libraryPath, modulePath);

    // Try exact path first
    const candidates = [
        basePath,
        basePath + ".ts",
        basePath + ".js",
        fpJoin(basePath, "index.ts"),
        fpJoin(basePath, "index.js"),
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return candidate;
        }
    }

    throw new Error(
        `Library module not found: "${LIBRARY_PREFIX}${modulePath}"\n` +
        `Searched in: ${basePath} (.ts, .js, /index.ts, /index.js)`
    );
}

/**
 * Create a patched require function that resolves `library/...` paths
 * to the script library folder.
 */
export function createLibraryRequire(libraryPath: string): NodeRequire {
    const nativeRequire = require;

    const libraryRequire = ((id: string) => {
        if (typeof id === "string" && id.startsWith(LIBRARY_PREFIX)) {
            const modulePath = id.slice(LIBRARY_PREFIX.length);
            const resolvedPath = resolveLibraryModule(libraryPath, modulePath);
            return nativeRequire(resolvedPath);
        }
        return nativeRequire(id);
    }) as NodeRequire;

    // Copy require properties (resolve, cache, extensions, main)
    libraryRequire.resolve = nativeRequire.resolve;
    libraryRequire.cache = nativeRequire.cache;
    libraryRequire.extensions = nativeRequire.extensions;
    libraryRequire.main = nativeRequire.main;

    return libraryRequire;
}

/**
 * Create a require wrapper that throws a clear error for `library/...` paths
 * when the script library is not linked.
 */
export function createUnlinkedLibraryRequire(): NodeRequire {
    const nativeRequire = require;

    const unlinkedRequire = ((id: string) => {
        if (typeof id === "string" && id.startsWith(LIBRARY_PREFIX)) {
            throw new Error(
                `Script library is not linked. Set the library folder in Settings → Script Library.`
            );
        }
        return nativeRequire(id);
    }) as NodeRequire;

    unlinkedRequire.resolve = nativeRequire.resolve;
    unlinkedRequire.cache = nativeRequire.cache;
    unlinkedRequire.extensions = nativeRequire.extensions;
    unlinkedRequire.main = nativeRequire.main;

    return unlinkedRequire;
}
