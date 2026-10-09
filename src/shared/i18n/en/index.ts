import { commonCatalog, type EnglishMessage } from "./common";
import { mainCatalog } from "./main";
import { settingsCatalog } from "./settings";
import { dialogsCatalog } from "./dialogs";

type MessagesOf<T> = { [K in keyof T]: T[K] extends { message: infer M } ? M : never };
export const englishCatalog = {
    common: Object.fromEntries(Object.entries(commonCatalog).map(([key, entry]) => [key, entry.message])),
    main: Object.fromEntries(Object.entries(mainCatalog).map(([key, entry]) => [key, entry.message])),
    settings: Object.fromEntries(Object.entries(settingsCatalog).map(([key, entry]) => [key, entry.message])),
    dialogs: {},
} as unknown as {
    common: MessagesOf<typeof commonCatalog>;
    main: MessagesOf<typeof mainCatalog>;
    settings: MessagesOf<typeof settingsCatalog>;
    dialogs: MessagesOf<typeof dialogsCatalog>;
};

export type EnglishCatalog = typeof englishCatalog;
export type MessageKey = {
    [Area in keyof EnglishCatalog]: `${Area & string}.${keyof EnglishCatalog[Area] & string}`
}[keyof EnglishCatalog];
export type MessageFor<K extends MessageKey> = K extends `${infer Area}.${infer Key}`
    ? Area extends keyof EnglishCatalog
        ? Key extends keyof EnglishCatalog[Area]
            ? EnglishCatalog[Area][Key]
            : never
        : never
    : never;
export type MessageParams<K extends MessageKey> = {
    [Name in PlaceholderNames<MessageFor<K>>]: string | number;
} & (MessageFor<K> extends { one: string; other: string } ? { count: number } : object);
type PlaceholderNames<T> = T extends string
    ? T extends `${string}{${infer Name}}${infer Rest}` ? Name | PlaceholderNames<Rest> : never
    : T extends object ? PlaceholderNames<T[keyof T]> : never;
export type { EnglishMessage };
