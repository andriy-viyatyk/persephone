let sucraseTransform: typeof import("sucrase").transform | undefined;

async function loadSucrase() {
    if (!sucraseTransform) {
        const mod = await import("sucrase");
        sucraseTransform = mod.transform;
    }
    return sucraseTransform;
}

/** Ensure sucrase is loaded. Call this before using getSucraseTransform(). */
export async function ensureSucraseLoaded(): Promise<void> {
    await loadSucrase();
}

/** Get the synchronous sucrase transform. Returns undefined if not yet loaded via ensureSucraseLoaded(). */
export function getSucraseTransform(): typeof import("sucrase").transform | undefined {
    return sucraseTransform;
}

export function isScriptLanguage(language: string): boolean {
    return language === "javascript" || language === "typescript";
}

export async function transpileIfNeeded(script: string, language?: string): Promise<string> {
    if (language !== "typescript") return script;
    const transform = await loadSucrase();
    return transform(script, { transforms: ["typescript"] }).code;
}
