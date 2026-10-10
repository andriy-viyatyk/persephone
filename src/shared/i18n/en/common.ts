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
    open: { message: "Open", note: "Generic action button or menu item that opens the selected item." },
    remove: { message: "Remove", note: "Generic action that removes an item from a list without necessarily deleting its files." },
    close: { message: "Close", note: "Generic close action; use the surrounding control to identify what closes." },
    apply: { message: "Apply", note: "Button applying the currently edited settings or options." },
    loading: { message: "Loading…", note: "Shown while content is being loaded." },
    todayAt: { message: "Today at {time}", note: "Date and time label; `{time}` is the formatted local time." },
    items: { message: { one: "{count} item", other: "{count} items" } },
} satisfies Record<string, EnglishCatalogEntry>;
