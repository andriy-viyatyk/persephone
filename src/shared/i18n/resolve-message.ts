import { englishCatalog, type MessageKey } from "./en";
import type { LanguagePack, PackMessage } from "./pack";

export function resolveMessage(
    key: MessageKey,
    userPack: LanguagePack | undefined,
    builtInPack: LanguagePack | undefined,
): PackMessage | undefined {
    const [area, name] = key.split(".");
    const english = (englishCatalog as Record<string, Record<string, PackMessage>>)[area]?.[name];
    return userPack?.messages[key] ?? builtInPack?.messages[key] ?? english;
}
