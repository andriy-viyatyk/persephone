import { settings } from "../api/settings";
import { clearLibraryRequireCache, registerLibraryExtensions } from "./library-require";

class ScriptLibrary {
    private sucraseTransform: typeof import("sucrase").transform | undefined;
    private libraryDirty = true;

    private async loadSucrase() {
        if (!this.sucraseTransform) {
            const mod = await import("sucrase");
            this.sucraseTransform = mod.transform;
        }
        return this.sucraseTransform;
    }

    private async ensureSucraseLoaded(): Promise<void> {
        await this.loadSucrase();
    }

    private getSucraseTransform(): typeof import("sucrase").transform | undefined {
        return this.sucraseTransform;
    }

    /** Mark library cache as dirty. Called by file watcher when library files change. */
    invalidateLibraryCache = () => {
        this.libraryDirty = true;
    };

    async transpileIfNeeded(script: string, language?: string): Promise<string> {
        if (language !== "typescript") return script;
        const transform = await this.loadSucrase();
        return transform(script, { transforms: ["typescript"] }).code;
    }

    async prepare(): Promise<void> {
        await this.ensureSucraseLoaded();

        const libraryPath = settings.get("script-library.path") as string | undefined;
        if (libraryPath) {
            registerLibraryExtensions(
                () => settings.get("script-library.path"),
                () => this.getSucraseTransform()
            );
            // Only clear cache when files actually changed (file watcher sets libraryDirty)
            if (this.libraryDirty) {
                clearLibraryRequireCache(libraryPath);
                this.libraryDirty = false;
            }
        }
    }
}

export const scriptLibrary = new ScriptLibrary();
