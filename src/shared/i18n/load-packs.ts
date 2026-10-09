import type { LanguagePack, PackLoadResult } from "./pack";
import { filterLanguagePack } from "./filter-pack";
import { validateLanguagePack } from "./validate-pack";

export interface PackFile { filename: string; value: unknown; }

export function loadLanguagePacks(files: readonly PackFile[], builtIn: boolean): PackLoadResult {
    const packs: LanguagePack[] = [];
    const warnings: string[] = [];
    for (const file of files) {
        const result = validateLanguagePack(file.value, file.filename);
        warnings.push(...result.warnings);
        if (result.value) packs.push(builtIn ? result.value : filterLanguagePack(result.value));
    }
    return { packs, warnings };
}
