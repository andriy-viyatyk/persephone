let sucraseTransform: typeof import("sucrase").transform | undefined;

async function loadSucrase() {
    if (!sucraseTransform) {
        const mod = await import("sucrase");
        sucraseTransform = mod.transform;
    }
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
