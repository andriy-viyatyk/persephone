import type { LanguagePack, PackMessage } from "./pack";
import { englishCatalog } from "./en";
import { pseudoText } from "./pseudo-text";

export function createPseudoLocalePack(): LanguagePack {
    const messages: LanguagePack["messages"] = {};
    for (const [area, entries] of Object.entries(englishCatalog)) {
        for (const [key, value] of Object.entries(entries)) {
            const fullKey = `${area}.${key}` as keyof typeof messages;
            messages[fullKey] = typeof value === "string"
                ? pseudoText(value)
                : Object.fromEntries(Object.entries(value as Record<string, string>).map(([category, text]) => [category, pseudoText(text)])) as PackMessage;
        }
    }
    return { schemaVersion: 1, code: "en-XA", name: "Pseudo-English", englishName: "Pseudo-English", messages };
}
