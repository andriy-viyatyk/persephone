import type { LanguagePack, PackLoadResult } from "./pack";
import { validateLanguagePack } from "./validate-pack";

export interface PackFile { filename: string; value: unknown; }

export function loadLanguagePacks(files: readonly PackFile[]): PackLoadResult {
    const packs: LanguagePack[] = [];
    const warnings: string[] = [];
    for (const file of files) {
        const result = validateLanguagePack(file.value, file.filename);
        warnings.push(...result.warnings);
        if (result.value) packs.push(result.value);
    }
    return { packs, warnings };
}
