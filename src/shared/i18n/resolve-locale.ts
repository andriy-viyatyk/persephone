import type { LanguagePack } from "./pack";

export function resolveLocale(requested: string, preferredLanguages: readonly string[], packs: readonly LanguagePack[]): string {
    if (requested.toLowerCase() === "en-xa") return "en-XA";
    // English is always available (the TypeScript catalog), so an OS list that prefers English
    // before another language stays English.
    const available = new Map(packs.map((pack) => [pack.code.toLowerCase(), pack.code]));
    if (!available.has("en")) available.set("en", "en");
    const match = (tag: string): string | undefined => {
        const normalized = tag.trim().replace(/_/g, "-").toLowerCase();
        return available.get(normalized) ?? available.get(normalized.split("-")[0]);
    };
    if (requested.toLowerCase() !== "auto") return match(requested) ?? "en";
    for (const language of preferredLanguages) {
        const found = match(language);
        if (found) return found;
    }
    return "en";
}
