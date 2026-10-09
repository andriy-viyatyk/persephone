import type { MessageKey } from "./en";
import type { PluralCategory } from "./en/common";

export type PackMessage = string | Partial<Record<PluralCategory, string>>;
export interface LanguagePack {
    schemaVersion: 1;
    code: string;
    name: string;
    englishName: string;
    direction?: "ltr";
    messages: Partial<Record<MessageKey, PackMessage>>;
    source?: Partial<Record<MessageKey, string>>;
}
export interface PackLoadResult {
    packs: LanguagePack[];
    warnings: string[];
}
