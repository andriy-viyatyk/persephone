import { getSucraseTransform } from "./transpile";

const fs = require("fs") as typeof import("fs");
const path = require("path") as typeof import("path");
const LIBRARY_PREFIX = "library/";

let tsExtensionRegistered = false;

/**
 * Register a `.ts` extension handler for Node.js require().
 * Uses the already-loaded sucrase transform for synchronous transpilation.
 * Must be called after `ensureSucraseLoaded()`.
 */
export function registerTsExtension(): void {
    if (tsExtensionRegistered) return;
    tsExtensionRegistered = true;

    const originalHandler = require.extensions[".js"];

    require.extensions[".ts"] = (module: NodeModule, filename: string) => {
        const transform = getSucraseTransform();
        if (!transform) {
            // Fallback: if sucrase somehow not loaded, use .js handler
            originalHandler(module, filename);
            return;
        }

        const code = fs.readFileSync(filename, "utf-8");
        const { code: compiled } = transform(code, {
            transforms: ["typescript", "imports"],
            filePath: filename,
        });
        (module as any)._compile(compiled, filename);
    };
}

/**
 * Clear all require.cache entries under the library folder.
 */
export function clearLibraryRequireCache(libraryPath: string): void {
    const normalizedLibPath = path.resolve(libraryPath);
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
    const basePath = path.join(libraryPath, modulePath);

    // Try exact path first
    const candidates = [
        basePath,
        basePath + ".ts",
        basePath + ".js",
        path.join(basePath, "index.ts"),
        path.join(basePath, "index.js"),
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
