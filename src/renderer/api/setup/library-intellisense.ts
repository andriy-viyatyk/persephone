import * as monaco from "monaco-editor";
import { libraryService } from "../library-service";
import { settings } from "../settings";

const nodefs = require("fs") as typeof import("fs");
const nodepath = require("path") as typeof import("path");

let disposables: monaco.IDisposable[] = [];
let loaded = false;

// =============================================================================
// Public API
// =============================================================================

/** Load library IntelliSense. Idempotent — only runs once. */
export function loadLibraryIntelliSense(): void {
    if (loaded) return;
    loaded = true;

    libraryService.ensureInitialized();
    registerLibraryFiles();

    libraryService.state.subscribe(() => {
        disposeAll();
        registerLibraryFiles();
    });
}

// =============================================================================
// Private
// =============================================================================

function registerLibraryFiles(): void {
    const libraryPath = settings.get("script-library.path");
    if (!libraryPath) return;

    const allFiles = libraryService.allFiles;
    for (const relativePath of allFiles) {
        const absolutePath = nodepath.join(libraryPath, relativePath);
        let content: string;
        try {
            content = nodefs.readFileSync(absolutePath, "utf-8");
        } catch {
            continue;
        }

        const virtualPath = `file:///library/${relativePath}`;

        disposables.push(
            monaco.languages.typescript.javascriptDefaults.addExtraLib(
                content,
                virtualPath,
            ),
        );
        disposables.push(
            monaco.languages.typescript.typescriptDefaults.addExtraLib(
                content,
                virtualPath,
            ),
        );
    }
}

function disposeAll(): void {
    for (const d of disposables) {
        d.dispose();
    }
    disposables = [];
}
