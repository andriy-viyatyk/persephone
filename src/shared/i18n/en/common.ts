export type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";
export type EnglishPluralMessage = Partial<Record<PluralCategory, string>> & { other: string };
export type EnglishMessage = string | EnglishPluralMessage;
export interface EnglishCatalogEntry<T extends EnglishMessage = EnglishMessage> {
    message: T;
    note?: string;
}

export const commonCatalog = {
    ok: { message: "OK" },
    cancel: { message: "Cancel" },
    open: { message: "Open" },
    remove: { message: "Remove" },
    loading: { message: "Loading…", note: "Shown while content is being loaded." },
    todayAt: { message: "Today at {time}" },
    items: { message: { one: "{count} item", other: "{count} items" } },
} satisfies Record<string, EnglishCatalogEntry>;
